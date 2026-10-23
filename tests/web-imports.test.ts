import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openApplication } from '../src/application.js';
import { McpManager } from '../src/integrations/mcp.js';
import { WebImports, midnight, calendarItems, notionCalendarEvent } from '../src/integrations/web-imports.js';
import { createHttpApp } from '../src/http.js';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { pageCopy } from '../src/page-copy.js';

async function fixture(unlinked = false) {
  const app = await openApplication({ vault: await mkdtemp(join(tmpdir(), 'openloci-web-import-')), timezone: 'Asia/Shanghai' });
  const mcp = new McpManager([{ id: 'notion', enabled: true, transport: 'stdio', command: process.execPath,
    args: ['--import', 'tsx', resolve('tests/fixtures/mcp-server.ts')], env: unlinked ? { FIXTURE_CALENDAR_UNLINKED: '1' } : {},
    inheritEnv: [], requiredEnv: [], allowedTools: [], timeoutMs: 10_000 }]);
  return { app, mcp };
}

test('web previews are read-only until selection is applied, deduplicate and exclude index pages', async t => {
  const { app, mcp } = await fixture();
  t.after(async () => { await mcp.close(); await app.close(); });
  const imports = new WebImports();
  const preview = await imports.preview(app, mcp, { source: 'notion', from: '2026-10-01', to: '2026-10-23' });
  assert.equal(preview.records.length, 1); assert.equal(preview.records[0].title, '10.21 Reading');
  assert.equal(await app.db.count(), 0);
  await assert.rejects(imports.apply(app, { preview_id: preview.preview_id, ids: ['not-in-preview'] }), /Unknown/);
  const selected = { preview_id: preview.preview_id, ids: preview.records.map(record => record.id) };
  assert.equal((await imports.apply(app, selected)).saved, 1);
  assert.equal((await imports.apply(app, selected)).saved, 1);
  assert.equal(await app.db.count(), 1);
  assert.equal((await app.search({ q: 'book' }))[0].record.source.kind, 'import');
  await assert.rejects(imports.apply(app, { preview_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ids: [] }), /expired/);
  const calendar = await imports.preview(app, mcp, { source: 'google-calendar', from: '2026-10-01', to: '2026-10-23' });
  assert.equal(calendar.records[0].title, 'Morning walk');
  assert.equal((await imports.apply(app, { preview_id: calendar.preview_id, ids: calendar.records.map(record => record.id) })).saved, 1);
  assert.equal((await app.search({ type: 'event' }))[0].record.attributes.start_at, '2026-10-21T08:00:00+08:00');
});

test('unlinked Google calendar has actionable localized HTTP feedback', async t => {
  const { app, mcp } = await fixture(true);
  const server = createHttpApp(app, mcp).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await mcp.close(); await app.close(); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/imports/preview?lang=zh-CN`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'google-calendar', from: '2026-10-01', to: '2026-10-23' }) });
  const data = await response.json();
  assert.equal(response.status, 409); assert.equal(data.code, 'calendar_connection_required'); assert.equal(data.error, pageCopy['zh-CN'].linkCalendar);
});

test('calendar boundaries use the vault timezone including DST', () => {
  assert.equal(midnight('2026-10-23', 'Asia/Shanghai'), '2026-10-22T16:00:00.000Z');
  assert.equal(midnight('2026-03-29', 'Europe/Berlin'), '2026-03-28T23:00:00.000Z');
  assert.equal(midnight('2026-03-30', 'Europe/Berlin'), '2026-03-29T22:00:00.000Z');
});

test('Notion account/calendar nesting preserves calendar identity, all-day periods and recurrence', () => {
  const items = calendarItems({ accounts: [{ accountId: 'google-account', providerName: 'google', calendars: [{ calendarId: 'holiday-calendar', name: 'Holidays', isPrimary: false,
    events: [{ eventId: 'holiday', summary: 'A holiday', eventStatus: 'confirmed', isRecurring: true, period: { type: 'DATE', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } } }],
  }] }], errors: [] });
  const record = notionCalendarEvent(items[0], 'fallback', 'Asia/Shanghai');
  assert.equal(record.source.account_id, 'google-account');
  assert.equal(record.attributes.calendar_id, 'holiday-calendar');
  assert.equal(record.attributes.calendar_name, 'Holidays');
  assert.equal(record.attributes.end_date, '2026-10-02');
  assert.equal(record.attributes.is_recurring, true);
  assert.equal(record.attributes.activity_state, 'scheduled');
});
