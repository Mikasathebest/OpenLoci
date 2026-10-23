import { z } from 'zod';
import { hash, recordSchema, AppError, dateSchema, type MemoryRecord } from '../core.js';
import { Application } from '../application.js';
import { McpManager } from './mcp.js';

export function unpack(result: Record<string, unknown>): unknown {
  if (result.structuredContent) return result.structuredContent;
  const content = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).parse(result.content || []);
  const text = content.filter(item => item.type === 'text').map(item => item.text || '').join('\n');
  if (text.length > 5_000_000) throw new AppError(502, 'MCP response exceeded import size limit');
  try { return JSON.parse(text); } catch { return { text }; }
}

function imported(server: string, account: string, remote: string, type: MemoryRecord['type'], input: Record<string, unknown>) {
  const now = new Date().toISOString();
  return recordSchema.parse({ id: `import-${hash(JSON.stringify([server, account, remote])).slice(0, 40)}`,
    type, created_at: now, updated_at: now, source: { kind: 'import', server_id: server, account_id: account, remote_id: remote }, ...input });
}

const timePoint = z.object({ dateTime: z.string().optional(), date: dateSchema.optional(), timeZone: z.string().optional() });
const eventSchema = z.object({
  id: z.string().min(1), summary: z.string().optional(), description: z.string().optional(),
  start: timePoint, end: timePoint, status: z.string().optional(), location: z.string().optional(),
  calendarId: z.string().optional(), accountId: z.string().optional(),
  recurringEventId: z.string().optional(), originalStartTime: timePoint.optional(), htmlLink: z.string().optional(),
}).passthrough();

export function normalizeEvent(raw: unknown, options: { server: string; account: string; calendarId: string; timezone: string }) {
  const event = eventSchema.parse(raw);
  const allDay = !!event.start.date;
  const start = allDay ? event.start.date : event.start.dateTime;
  const end = allDay ? event.end.date : event.end.dateTime;
  if (!start || !end) throw new AppError(422, `Event ${event.id} has incomplete times`);
  if (!allDay && (!z.string().datetime({ offset: true }).safeParse(start).success || !z.string().datetime({ offset: true }).safeParse(end).success)) {
    throw new AppError(422, `Event ${event.id} needs explicit timestamp offsets`);
  }
  if ((allDay ? end <= start : +new Date(end) <= +new Date(start))) throw new AppError(422, `Event ${event.id} ends before it starts`);
  const calendar = event.calendarId || options.calendarId;
  const account = event.accountId || options.account;
  return imported(options.server, account, `${calendar}:${event.id}`, 'event', {
    title: event.summary || 'Untitled event', date: start.slice(0, 10), timezone: event.start.timeZone || options.timezone,
    body: event.description || '', attributes: {
      all_day: allDay, ...(allDay ? { start_date: start, end_date: end } : { start_at: start, end_at: end }),
      status: event.status || 'confirmed', ...(event.location ? { location: event.location } : {}),
      calendar_id: calendar, ...(event.recurringEventId ? { recurring_event_id: event.recurringEventId, original_start_time: event.originalStartTime } : {}),
    },
  });
}

export async function importCalendar(app: Application, mcp: McpManager, input: unknown) {
  const options = z.object({ server: z.string().default('google-calendar'), account: z.string().min(1),
    calendarId: z.string().min(1).default('primary'), timeMin: z.string().datetime({ offset: true }), timeMax: z.string().datetime({ offset: true }),
    apply: z.boolean().default(false),
  }).refine(q => +new Date(q.timeMax) > +new Date(q.timeMin) && +new Date(q.timeMax) - +new Date(q.timeMin) <= 93 * 86400_000, 'Import window must be positive and no more than 93 days').parse(input);
  const response = await mcp.call(options.server, 'list-events', { calendarId: options.calendarId, account: options.account,
    timeMin: options.timeMin, timeMax: options.timeMax, timeZone: app.timezone });
  const payload = z.object({ events: z.array(z.unknown()).max(5000), warnings: z.array(z.string()).optional(),
    partialFailures: z.array(z.unknown()).optional() }).passthrough().parse(unpack(response));
  if (payload.partialFailures?.length) throw new AppError(502, 'Calendar server returned partial results; retry a single account/calendar');
  const candidates = payload.events.map(event => normalizeEvent(event, { ...options, timezone: app.timezone }));
  // Explicit bounded imports, with preview by default. No background sync or cursor promises in v0.1.
  if (!options.apply) return { preview: true, count: candidates.length, records: candidates, warnings: payload.warnings || [] };
  const results = [];
  for (const record of candidates) {
    try { const result = await app.importRecord(record); results.push({ id: record.id, status: result.status }); }
    catch (error) { results.push({ id: record.id, status: 'failed', error: (error as Error).message }); }
  }
  return { preview: false, results, warnings: payload.warnings || [] };
}

export async function importNotion(app: Application, mcp: McpManager, input: unknown) {
  const options = z.object({ server: z.string().default('notion'), account: z.string().min(1),
    page: z.string().min(1), date: dateSchema, title: z.string().min(1), apply: z.boolean().default(false) }).parse(input);
  const result = await mcp.call(options.server, 'notion-fetch', { id: options.page });
  const payload = unpack(result);
  let body: string;
  if (typeof payload === 'string') body = payload;
  else if (payload && typeof payload === 'object' && typeof (payload as { text?: unknown }).text === 'string') body = (payload as { text: string }).text;
  else body = JSON.stringify(payload, null, 2);
  // Use a canonical page ID so URL query parameters cannot create duplicate imports.
  const compact = options.page.split('?')[0].match(/([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:$|\/)/i)?.[1];
  if (!compact) throw new AppError(422, 'Provide a Notion page UUID or a URL ending with its page ID');
  const record = imported(options.server, options.account, compact.replace(/-/g, '').toLowerCase(), 'journal', {
    title: options.title, date: options.date, timezone: app.timezone, body,
    attributes: { notion_page_id: compact.replace(/-/g, '').toLowerCase() },
  });
  if (!options.apply) return { preview: true, record };
  const saved = await app.importRecord(record);
  return { preview: false, status: saved.status, id: saved.record.record.id };
}
