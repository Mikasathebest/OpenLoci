import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApplication } from '../src/application.js';
import { parseMarkdown, serialize } from '../src/vault.js';
import { renderMarkdown } from '../src/rendering.js';
import { recordSchema } from '../src/core.js';

const base = { type: 'journal', title: 'A good day', date: '2026-10-23', body: 'Walking and tofu for lunch.' };
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'openloci-test-'));
  const app = await openApplication({ vault: root, timezone: 'Asia/Shanghai' });
  t.after(() => app.close());
  return app;
}

test('capture, FTS search, revision checks, metadata preservation and durable reload', async t => {
  const app = await setup(t);
  const saved = await app.create({ ...base, custom: { keep: true } });
  assert.equal((await app.search({ q: 'tofu' }))[0].record.id, saved.record.id);
  assert.equal((await app.search({ q: "' OR 1=1 --" })).length, 0);
  await assert.rejects(app.update(saved.record.id, { title: 'Conflict' }, 'wrong'), /revision/);
  const updated = await app.update(saved.record.id, { title: 'Even better' }, saved.hash);
  assert.deepEqual(updated.record.custom, { keep: true });
  assert.notEqual(updated.hash, saved.hash);
  const content = await readFile(join(app.vault.root, updated.path), 'utf8');
  assert.equal(parseMarkdown(content).title, 'Even better');
  assert.equal((await app.search({ q: 'better' })).length, 1);
  assert.equal((await app.search({ type: 'meal' })).length, 0);
  assert.equal((await app.search({ from: '2026-10-24' })).length, 0);
  const history = join(app.vault.root, '.openloci', 'history', saved.record.id, `${saved.hash}.md`);
  assert.equal(parseMarkdown(await readFile(history, 'utf8')).title, base.title);
});

test('external edits, file moves, invalid files and deletion reconciliation', async t => {
  const app = await setup(t);
  const saved = await app.create(base);
  const edited = recordSchema.parse({ ...saved.record, title: 'Hand edited', body: 'Fresh grapefruit' });
  await writeFile(join(app.vault.root, saved.path), serialize(edited));
  assert.equal((await app.get(saved.record.id)).record.title, 'Hand edited');
  await assert.rejects(app.update(saved.record.id, { title: 'Old client' }, saved.hash), /revision/);
  assert.equal((await app.rebuild()).indexed, 1);
  assert.equal((await app.search({ q: 'grapefruit' })).length, 1);
  await mkdir(join(app.vault.root, 'records', 'moved'));
  await rename(join(app.vault.root, saved.path), join(app.vault.root, 'records', 'moved', 'entry.md'));
  await app.rebuild();
  assert.equal((await app.get(saved.record.id)).path, 'records/moved/entry.md');
  await writeFile(join(app.vault.root, 'records', 'broken.md'), 'not valid frontmatter');
  assert.equal((await app.rebuild()).errors.length, 1);
  assert.equal(await app.db.count(), 1);
  // Move invalid content outside the active records tree, then move the record out too.
  await rename(join(app.vault.root, 'records', 'broken.md'), join(app.vault.root, 'broken.txt'));
  await rename(join(app.vault.root, 'records', 'moved', 'entry.md'), join(app.vault.root, 'archived.md'));
  assert.equal((await app.rebuild()).indexed, 0);
  assert.equal(await app.db.count(), 0);
});

test('path traversal, symlink escapes and invalid domain data are rejected', async t => {
  const app = await setup(t);
  await assert.rejects(app.create({ ...base, id: '../../escape' }));
  await assert.rejects(app.create({ ...base, date: '2026-02-30' }));
  await assert.rejects(app.create({ ...base, type: 'expense', attributes: { amount_minor: 2.5, currency: 'USD' } }));
  await assert.rejects(app.create({ ...base, source: { kind: 'import' } }), /server_id/);
  await assert.rejects(app.vault.read('../outside.md'), /outside vault/);
  const outside = await mkdtemp(join(tmpdir(), 'openloci-outside-'));
  await mkdir(join(app.vault.root, 'records'), { recursive: true });
  await symlink(outside, join(app.vault.root, 'records', 'journal'));
  await assert.rejects(app.create(base), /Symlinks/);
});

test('serialization preserves multiline prose and unknown fields', async t => {
  const app = await setup(t);
  const body = '# Today\n\n- Breakfast\n- A walk\n\n```js\nconst n = 1;\n```\n';
  const item = await app.create({ ...base, body, extra_field: 'yes' });
  assert.deepEqual(parseMarkdown(serialize(item.record)), item.record);
});

test('renderer strips active content and remote images', () => {
  const html = renderMarkdown('<script>alert(1)</script><iframe src="https://example.com"></iframe>\n\n![tracking](https://evil.invalid/a.png)\n\n[bad](javascript:alert)\n\n**safe**');
  assert.doesNotMatch(html, /<script|<iframe|<img|javascript:/);
  assert.match(html, /<strong>safe<\/strong>/);
});

test('restricted edits are not exposed through stale MCP search indexes', async t => {
  const app = await setup(t);
  const item = await app.create({ ...base, body: 'secret mushrooms' });
  await writeFile(join(app.vault.root, item.path), serialize(recordSchema.parse({ ...item.record, sensitivity: 'restricted' })));
  assert.equal((await app.search({ q: 'mushrooms' }, false)).length, 0);
  await assert.rejects(app.get(item.record.id, false), /not found/);
});
