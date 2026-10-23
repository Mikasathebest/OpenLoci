import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openApplication } from '../src/application.js';
import { McpManager, initializeRegistry, readRegistry } from '../src/integrations/mcp.js';
import { importCalendar, importNotion, normalizeEvent } from '../src/integrations/imports.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemoryServer } from '../src/mcp-server.js';

test('real stdio MCP sessions import both providers with preview, deduplication and conflict checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'openloci-mcp-'));
  const app = await openApplication({ vault: root, timezone: 'Asia/Shanghai' });
  const manager = new McpManager(['notion', 'google-calendar'].map(id => ({
    id, enabled: true, transport: 'stdio', command: process.execPath, args: ['--import', 'tsx', resolve('tests/fixtures/mcp-server.ts')],
    env: {}, inheritEnv: [], requiredEnv: [], allowedTools: ['notion-fetch', 'list-events'], timeoutMs: 10_000,
  })));
  t.after(async () => { await manager.close(); await app.close(); });
  const tools = await manager.tools('notion');
  assert.equal(tools.find(tool => tool.name === 'dangerous-write')?.allowed, false);
  await assert.rejects(manager.call('notion', 'dangerous-write', {}), /not allowed/);
  const calendar = { account: 'personal', calendarId: 'primary', timeMin: '2026-10-23T00:00:00+08:00', timeMax: '2026-10-24T00:00:00+08:00' };
  assert.equal((await importCalendar(app, manager, calendar)).preview, true);
  assert.equal(await app.db.count(), 0);
  const imported = await importCalendar(app, manager, { ...calendar, apply: true });
  assert.equal(imported.preview, false);
  await importCalendar(app, manager, { ...calendar, apply: true });
  assert.equal(await app.db.count(), 1);
  const options = { account: 'workspace-one', page: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', date: '2026-10-23', title: 'Weekly reflection' };
  assert.equal((await importNotion(app, manager, options)).preview, true);
  await importNotion(app, manager, { ...options, apply: true });
  await importNotion(app, manager, { ...options, page: 'https://notion.so/Reflection-aaaaaaaabbbbccccddddeeeeeeeeeeee?source=copy', apply: true });
  assert.equal(await app.db.count(), 2);
  const journal = (await app.search({ type: 'journal' }))[0];
  await app.update(journal.record.id, { body: 'My local edit' }, journal.hash);
  await assert.rejects(importNotion(app, manager, { ...options, title: 'Remote title change', apply: true }), /conflict/);
  assert.equal((await app.get(journal.record.id)).record.body, 'My local edit');
  assert.equal((await manager.status()).filter(server => server.connected).length, 2);
});

test('registry initialization does not overwrite configuration and missing credentials fail before launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openloci-config-'));
  const path = join(root, 'mcp.json');
  await initializeRegistry(path, root);
  await assert.rejects(initializeRegistry(path, root), /EEXIST/);
  const registry = await readRegistry(path);
  const manager = new McpManager(registry);
  await assert.rejects(manager.connect('notion'), /disabled/);
  const google = registry.find(server => server.id === 'google-calendar')!;
  google.enabled = true;
  google.requiredEnv = ['OPENLOCI_TEST_MISSING_CREDENTIAL'];
  await assert.rejects(manager.connect('google-calendar'), /OPENLOCI_TEST_MISSING_CREDENTIAL/);
});

test('calendar normalization preserves all-day exclusive end dates and recurrence identities', () => {
  const record = normalizeEvent({ id: 'occurrence-one', summary: 'Trip', start: { date: '2026-10-23' }, end: { date: '2026-10-25' }, recurringEventId: 'series-one' },
    { server: 'google-calendar', account: 'personal', calendarId: 'primary', timezone: 'Asia/Shanghai' });
  assert.equal(record.attributes.end_date, '2026-10-25');
  assert.equal(record.attributes.all_day, true);
  assert.equal(record.attributes.recurring_event_id, 'series-one');
  assert.throws(() => normalizeEvent({ id: 'bad', start: { dateTime: '2026-10-23T08:00:00' }, end: { dateTime: '2026-10-23T09:00:00' } },
    { server: 'g', account: 'a', calendarId: 'c', timezone: 'UTC' }), /offsets/);
});

test('assistant MCP exposes read-only standard records and bounded context', async t => {
  const root = await mkdtemp(join(tmpdir(), 'openloci-assistant-'));
  const app = await openApplication({ vault: root, timezone: 'UTC' });
  await app.create({ type: 'journal', date: '2026-10-23', title: 'Public to local assistant', body: 'Walking '.repeat(300) });
  const secret = await app.create({ type: 'journal', date: '2026-10-23', title: 'Private health', sensitivity: 'restricted', body: 'secret' });
  const server = createMemoryServer(app);
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(left), client.connect(right)]);
  t.after(async () => { await client.close(); await server.close(); await app.close(); });
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['memory_context', 'memory_get', 'memory_search']);
  const searched = await client.callTool({ name: 'memory_search', arguments: {} });
  assert.doesNotMatch(JSON.stringify(searched), /Private health/);
  const denied = await client.callTool({ name: 'memory_get', arguments: { id: secret.record.id } });
  assert.equal(denied.isError, true);
  const context = await client.callTool({ name: 'memory_context', arguments: { maxBytes: 512 } });
  const text = (context.content as { text: string }[])[0].text;
  assert.ok(Buffer.byteLength(text) <= 512);
  assert.equal(JSON.parse(text).truncated, true);
});
