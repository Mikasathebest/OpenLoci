import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { openApplication } from '../src/application.js';
import { createHttpApp } from '../src/http.js';
import { McpManager } from '../src/integrations/mcp.js';
import { locales } from '../src/i18n.js';
import { pageCopy } from '../src/page-copy.js';

test('custom pages survive reload and checklist updates preserve metadata and revision conflicts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'openloci-pages-'));
  let app = await openApplication({ vault: root, timezone: 'UTC' });
  t.after(() => app.close());
  const page = await app.pages.create({ title: 'Reading', description: 'Books and **thoughts**', layout: 'checklist' });
  const other = await app.pages.create({ title: 'Ideas', layout: 'notes' });
  const record = await app.create({ type: 'journal', title: 'Read a book', date: '2026-10-23', page_id: page.page.id, attributes: { rating: 5 } });
  await app.create({ type: 'journal', title: 'An unrelated idea', date: '2026-10-23', page_id: other.page.id });
  assert.match(await readFile(join(root, page.path), 'utf8'), /Books and \*\*thoughts\*\*/);
  assert.equal((await app.search({ page_id: page.page.id })).length, 1);
  const completed = await app.completePageRecord(page.page.id, record.record.id, true, record.hash);
  assert.deepEqual(completed.record.attributes, { rating: 5, completed: true });
  await assert.rejects(app.completePageRecord(page.page.id, record.record.id, false, record.hash), /revision/);
  await assert.rejects(app.completePageRecord(other.page.id, record.record.id, false, completed.hash), /not a checklist/);
  await app.close(); app = await openApplication({ vault: root, timezone: 'UTC' });
  assert.equal((await app.pages.list()).length, 2);
  assert.equal((await app.pages.get(page.page.id)).page.description, 'Books and **thoughts**');
  assert.equal((await app.search({ page_id: page.page.id }))[0].record.attributes.completed, true);
  await assert.rejects(app.pages.create({ title: ' ', layout: 'script' }));
  await assert.rejects(app.pages.get('../escape'));
  await assert.rejects(app.create({ type: 'journal', title: 'Invalid page', date: '2026-10-23', page_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }), /Page not found/);
});

test('sidebar creation, three layouts, safe titles, localized dialogs and checklist HTTP updates', async t => {
  const app = await openApplication({ vault: await mkdtemp(join(tmpdir(), 'openloci-pages-http-')), timezone: 'UTC' });
  const server = createHttpApp(app, new McpManager([])).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await app.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const json = { 'Content-Type': 'application/json' };
  for (const layout of ['notes', 'checklist', 'table']) {
    const created = await fetch(base + '/api/pages', { method: 'POST', headers: json, body: JSON.stringify({ title: '<script>Reading</script>', description: 'A **private** page', layout }) });
    assert.equal(created.status, 201);
    const page = await created.json();
    const record = await app.create({ type: 'journal', title: `Entry ${layout}`, date: '2026-10-23', body: 'Original text', page_id: page.page.id });
    const html = await (await fetch(`${base}/pages/${page.page.id}`)).text();
    assert.match(html, /&lt;script&gt;Reading/); assert.doesNotMatch(html, /<script>Reading/);
    assert.match(html, /A <strong>private<\/strong> page/);
    assert.match(html, new RegExp(`Entry ${layout}`));
    assert.match(html, /name="page_id"/);
    if (layout === 'table') assert.match(html, /<table>/);
    if (layout === 'checklist') {
      assert.match(html, /id="custom-checklist"/);
      const response = await fetch(`${base}/api/pages/${page.page.id}/records/${record.record.id}`, { method: 'PATCH', headers: { ...json, 'If-Match': record.hash }, body: JSON.stringify({ completed: true }) });
      assert.equal(response.status, 200); assert.equal((await response.json()).record.attributes.completed, true);
    }
  }
  for (const locale of locales) {
    const html = await (await fetch(`${base}/?lang=${locale}`)).text();
    assert.ok(html.includes('+ ' + pageCopy[locale].more));
    assert.ok(html.includes(pageCopy[locale].importNotion));
    assert.ok(html.includes(pageCopy[locale].importGoogle));
  }
  assert.equal((await (await fetch(base + '/api/pages')).json()).length, 3);
});
