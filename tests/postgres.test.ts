import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApplication } from '../src/application.js';
import { openDatabase } from '../src/db.js';
import { transferDatabase } from '../src/transfer.js';

test('PostgreSQL transfer verifies complete records, FTS, filters and refusal to overwrite', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const app = await openApplication({ vault: await mkdtemp(join(tmpdir(), 'openloci-transfer-')), timezone: 'UTC' });
  const postgres = await openDatabase(app.vault.root, process.env.TEST_DATABASE_URL);
  t.after(async () => { await app.close(); await postgres.close(); });
  const first = await app.create({ type: 'exercise', title: 'Morning run', date: '2026-10-23', body: 'Riverside running', attributes: { duration_seconds: 1800 }, custom: { preserved: true } });
  await app.create({ type: 'expense', title: 'Lunch', date: '2026-10-22', body: 'Tofu', attributes: { amount_minor: 1250, currency: 'USD' } });
  assert.deepEqual(await transferDatabase(app.db, postgres), { preview: true, records: 2, target: 'postgres' });
  assert.equal(await postgres.count(), 0);
  assert.equal((await transferDatabase(app.db, postgres, true)).preview, false);
  assert.deepEqual(await postgres.get(first.record.id), first);
  assert.equal((await postgres.search({ q: 'running', type: 'exercise', limit: 20, offset: 0 }))[0].record.id, first.record.id);
  assert.equal((await postgres.search({ from: '2026-10-23', limit: 20, offset: 0 })).length, 1);
  await assert.rejects(transferDatabase(app.db, postgres, true), /empty target/);
  // A failed transaction cannot leave partial copied rows.
  await assert.rejects(postgres.driver.transaction(async driver => {
    await driver.query('DELETE FROM records'); throw new Error('simulated interruption');
  }), /simulated interruption/);
  assert.equal(await postgres.count(), 2);
});
