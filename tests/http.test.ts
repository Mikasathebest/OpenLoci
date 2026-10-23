import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { openApplication } from '../src/application.js';
import { createHttpApp } from '../src/http.js';
import { McpManager } from '../src/integrations/mcp.js';

test('HTTP capture, search, revision-protected editing, safe HTML, and origin protection', async t => {
  const app = await openApplication({ vault: await mkdtemp(join(tmpdir(), 'openloci-http-')), timezone: 'UTC' });
  const manager = new McpManager([]);
  const server = createHttpApp(app, manager).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await app.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const created = await fetch(`${base}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'meal', title: '<script>bad</script>', date: '2026-10-23', body: '**Tofu**\n<script>alert(1)</script>' }) });
  assert.equal(created.status, 201);
  const item = await created.json();
  assert.equal((await (await fetch(`${base}/api/records?q=Tofu`)).json()).length, 1);
  const html = await (await fetch(`${base}/records/${item.record.id}`)).text();
  assert.match(html, /&lt;script&gt;bad/); assert.doesNotMatch(html, /<script>/);
  const patch = (headers: Record<string, string>) => fetch(`${base}/api/records/${item.record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ title: 'Lunch' }) });
  assert.equal((await patch({})).status, 428);
  assert.equal((await patch({ 'If-Match': 'wrong' })).status, 409);
  assert.equal((await patch({ 'If-Match': `"${item.hash}"` })).status, 200);
  assert.equal((await patch({ Origin: 'https://evil.invalid' })).status, 403);
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(base, { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
  const home = await fetch(base);
  assert.equal(home.status, 200); assert.match(home.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
});
