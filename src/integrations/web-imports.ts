import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, dateSchema, hash, recordSchema, type MemoryRecord } from '../core.js';
import { Application } from '../application.js';
import { McpManager } from './mcp.js';
import { normalizeEvent, unpack } from './imports.js';

export const importRangeSchema = z.object({ source: z.enum(['notion', 'google-calendar']), from: dateSchema, to: dateSchema }).strict()
  .refine(input => input.from <= input.to && Date.parse(input.to) - Date.parse(input.from) < 93 * 86400_000, 'Choose up to 93 days');

function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(502, 'Unexpected MCP response');
  return value as Record<string, unknown>;
}

export function midnight(date: string, timezone: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let value = target;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  for (let i = 0; i < 3; i++) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    const shown = Date.UTC(+fields.year, +fields.month - 1, +fields.day, +fields.hour, +fields.minute, +fields.second);
    value += target - shown;
    if (shown === target) return new Date(value).toISOString();
  }
  throw new AppError(400, 'Date cannot be resolved in this timezone');
}

function noteDate(title: string, fallback: string, from: string, to: string, timezone: string) {
  const full = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\D|$)/.exec(title);
  const short = /^(\d{1,2})[./-](\d{1,2})(?:\D|$)/.exec(title);
  if (full || short) {
    const years = full ? [full[1]] : [...new Set([from.slice(0, 4), to.slice(0, 4)])];
    for (const year of years) {
      const date = `${year}-${(full ? full[2] : short![1]).padStart(2, '0')}-${(full ? full[3] : short![2]).padStart(2, '0')}`;
      if (dateSchema.safeParse(date).success && date >= from && date <= to) return date;
    }
    return undefined;
  }
  const time = new Date(fallback);
  if (Number.isNaN(+time)) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return date >= from && date <= to ? date : undefined;
}

export function notionCalendarEvent(raw: unknown, account: string, timezone: string) {
  const event = plain(raw);
  const calendar = event.calendar ? plain(event.calendar) : {};
  const period = event.period ? plain(event.period) : undefined;
  const point = (value: unknown, allDay: boolean) => typeof value === 'string' ? { [allDay ? 'date' : 'dateTime']: value } : value;
  const record = normalizeEvent({ ...event, id: event.id || event.eventId, summary: event.summary || event.title,
    status: event.status || event.eventStatus,
    start: event.start || (period && point(period.start, period.type === 'DATE')),
    end: event.end || (period && point(period.end, period.type === 'DATE')),
    accountId: calendar.accountId || event.accountId || account, calendarId: calendar.calendarId || event.calendarId,
  }, { server: 'notion-calendar', account, calendarId: String(calendar.calendarId || event.calendarId || 'primary'), timezone });
  record.attributes = { ...record.attributes, calendar_name: event.calendarName, calendar_primary: event.calendarPrimary,
    is_recurring: event.isRecurring === true, activity_state: 'scheduled', source_url: event.webUrl || event.htmlLink };
  return record;
}

export function calendarItems(payload: Record<string, unknown>): unknown[] {
  if (Array.isArray(payload.events)) return payload.events;
  const groups = Array.isArray(payload.accounts) ? payload.accounts.filter(item => !plain(item).providerName || plain(item).providerName === 'google').flatMap(item => {
    const account = plain(item);
    return z.array(z.unknown()).parse(account.calendars).map(calendar => ({ ...plain(calendar), accountId: account.accountId }));
  }) : payload.calendars;
  if (!Array.isArray(groups)) throw new AppError(502, 'Unexpected calendar response');
  return groups.flatMap(item => {
    const group = plain(item);
    return z.array(z.unknown()).parse(group.events).map(event => ({ ...plain(event), calendarName: group.name, calendarPrimary: group.isPrimary,
      calendar: { accountId: group.accountId, calendarId: group.calendarId, ...(plain(event).calendar ? plain(plain(event).calendar) : {}) } }));
  });
}

export class WebImports {
  private previews = new Map<string, { records: MemoryRecord[]; expires: number }>();
  private clean() { for (const [id, preview] of this.previews) if (preview.expires < Date.now()) this.previews.delete(id); }
  async preview(app: Application, mcp: McpManager, input: unknown) {
    const range = importRangeSchema.parse(input);
    await mcp.enableNotionImport(app.vault.root);
    const identity = plain(unpack(await mcp.call('notion', 'notion-get-self', {})));
    const workspace = plain(identity.workspace);
    const account = z.string().min(1).parse(workspace.id);
    const records: MemoryRecord[] = [];
    const warnings: string[] = [];
    if (range.source === 'notion') {
      const result = plain(unpack(await mcp.call('notion', 'notion-search', { query: '',
        filters: { created_date_range: { start_date: range.from, end_date: range.to } }, page_size: 50 })));
      const candidates = z.array(z.object({ id: z.string(), title: z.string(), timestamp: z.string().optional(), url: z.string().optional() }).passthrough()).max(50).parse(result.results);
      if (candidates.length === 50 || result.has_more === true) warnings.push('search_limit');
      for (let i = 0; i < candidates.length; i += 3) {
        const batch = await Promise.allSettled(candidates.slice(i, i + 3).map(async candidate => {
          const fetched = plain(unpack(await mcp.call('notion', 'notion-fetch', { id: candidate.id })));
          const text = z.string().parse(fetched.text);
          const opening = /(?:^|\n)<content>\r?\n?/.exec(text), closing = text.lastIndexOf('</content>');
          const body = (opening && closing > opening.index ? text.slice(opening.index + opening[0].length, closing) : text).trim();
          // Index pages containing only child-page links are navigation, not diary entries.
          if (!body.replace(/<page\b[^>]*>[\s\S]*?<\/page>/g, '').replace(/<p\s*\/>/g, '').trim()) return;
          const title = typeof fetched.title === 'string' ? fetched.title : candidate.title;
          const date = noteDate(title, candidate.timestamp || String(fetched.page_last_edited_at || ''), range.from, range.to, app.timezone);
          if (!date) return;
          const remoteId = candidate.id.replace(/-/g, '').toLowerCase();
          const now = new Date().toISOString();
          if (fetched.truncated === true) warnings.push('truncated');
          records.push(recordSchema.parse({ id: `import-${hash(JSON.stringify(['notion', account, remoteId])).slice(0, 40)}`,
            type: 'journal', title, date, timezone: app.timezone, body, created_at: now, updated_at: now,
            source: { kind: 'import', server_id: 'notion', account_id: account, remote_id: remoteId },
            attributes: { notion_page_id: remoteId, source_url: fetched.url || candidate.url,
              source_path: fetched.path, remote_updated_at: fetched.page_last_edited_at, source_truncated: fetched.truncated === true },
          }));
        }));
        if (batch.some(result => result.status === 'rejected')) warnings.push('partial');
      }
    } else {
      const calendars = plain(unpack(await mcp.call('notion', 'notion-calendar-list-calendars', {})));
      if (Array.isArray(calendars.accounts) && !calendars.accounts.some(item => plain(item).providerName === 'google')) throw new AppError(409, 'Connect a Google calendar in Notion.', 'calendar_connection_required');
      const nextDay = new Date(Date.parse(range.to) + 86400_000).toISOString().slice(0, 10);
      const payload = plain(unpack(await mcp.call('notion', 'notion-calendar-list-events', {
        timeMin: midnight(range.from, app.timezone), timeMax: midnight(nextDay, app.timezone), timeZone: app.timezone,
      })));
      const items = calendarItems(payload);
      if (items.length > 1000) throw new AppError(502, 'Oversized calendar response');
      if (Array.isArray(payload.errors) && payload.errors.length) warnings.push('partial');
      if (payload.has_more === true || payload.nextPageToken) warnings.push('search_limit');
      for (const item of items) {
        try { records.push(notionCalendarEvent(item, account, app.timezone)); } catch { warnings.push('partial'); }
      }
      if (items.length && !records.length) throw new AppError(502, 'Calendar event format could not be normalized');
    }
    if (Buffer.byteLength(JSON.stringify(records)) > 10_000_000) throw new AppError(413, 'Preview too large; choose a shorter date range');
    this.clean();
    if (this.previews.size >= 10) this.previews.delete(this.previews.keys().next().value!);
    const id = randomUUID();
    records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    this.previews.set(id, { records, expires: Date.now() + 30 * 60_000 });
    return { preview_id: id, source: range.source, workspace: String(workspace.name || ''), from: range.from, to: range.to,
      warnings: [...new Set(warnings)], records: records.map(record => ({ id: record.id, title: record.title, date: record.date, body: record.body.slice(0, 400), calendar: record.attributes.calendar_name })) };
  }
  async apply(app: Application, input: unknown) {
    const options = z.object({ preview_id: z.string().uuid(), ids: z.array(z.string()).max(1000) }).strict().parse(input);
    this.clean();
    const preview = this.previews.get(options.preview_id);
    if (!preview) throw new AppError(410, 'Preview expired; load it again', 'preview_expired');
    const selected = new Set(options.ids);
    if (options.ids.some(id => !preview.records.some(record => record.id === id))) throw new AppError(400, 'Unknown preview record');
    const results = [];
    for (const record of preview.records.filter(record => selected.has(record.id))) {
      try { const result = await app.importRecord(structuredClone(record)); results.push({ id: record.id, status: result.status }); }
      catch { results.push({ id: record.id, status: 'failed' }); }
    }
    return { results, saved: results.filter(result => result.status !== 'failed').length, failed: results.filter(result => result.status === 'failed').length };
  }
}
