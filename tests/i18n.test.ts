import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { Script, createContext } from 'node:vm';
import { openApplication } from '../src/application.js';
import { createHttpApp } from '../src/http.js';
import { McpManager } from '../src/integrations/mcp.js';
import { locales, resolveLocale, messages } from '../src/i18n.js';
import { browserScript } from '../src/pages.js';

test('language negotiation respects explicit choice, cookie, browser quality and safe fallback', () => {
  assert.equal(resolveLocale('es', 'openloci_lang=ja', 'zh-CN'), 'es');
  assert.equal(resolveLocale(undefined, 'other=value; openloci_lang=ja', 'es'), 'ja');
  assert.equal(resolveLocale(undefined, '', 'fr;q=1, es-MX;q=0.8, ja;q=0.7'), 'es');
  assert.equal(resolveLocale(undefined, '', 'ja;q=0, en;q=0.5'), 'en');
  assert.equal(resolveLocale('<script>', 'openloci_lang=<script>', 'xx'), 'en');
});

test('all four locales render, preserve original notes and filters, and persist to detail pages', async t => {
  const app = await openApplication({ vault: await mkdtemp(join(tmpdir(), 'openloci-locales-')), timezone: 'UTC' });
  const saved = await app.create({ type: 'journal', title: 'Original 原文', date: '2026-10-23', body: 'My untouched notes 原文のまま' });
  const server = createHttpApp(app, new McpManager([])).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await app.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const locale of locales) {
    const response = await fetch(`${base}/?lang=${locale}&q=untouched&type=journal&from=2026-10-01`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Language'), locale);
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    const html = await response.text();
    assert.ok(html.includes(`<html lang="${locale}">`));
    assert.ok(html.includes(messages[locale].saveMemory));
    assert.match(html, /My untouched notes 原文のまま/);
    assert.match(html, /type="hidden" name="q" value="untouched"/);
    assert.match(html, /type="hidden" name="from" value="2026-10-01"/);
    const detail = await fetch(`${base}/records/${saved.record.id}`, { headers: { Cookie: cookie } });
    const detailHtml = await detail.text();
    assert.ok(detailHtml.includes(`<html lang="${locale}">`));
    assert.ok(detailHtml.includes(messages[locale].attributes));
    assert.ok(detailHtml.includes('name="lang"'));
    const error = await fetch(`${base}/api/records?lang=${locale}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal((await error.json()).error, messages[locale].invalidJson);
    const js = await (await fetch(`${base}/assets/app.js?lang=${locale}`)).text();
    assert.ok(js.includes(messages[locale].invalidAttributes));
    // Detail pages have no capture form; the shared script must still run for their language switch.
    new Script(browserScript(locale)).runInContext(createContext({ document: { querySelector: () => null } }));
  }
  assert.equal((await app.get(saved.record.id)).hash, saved.hash);
});
