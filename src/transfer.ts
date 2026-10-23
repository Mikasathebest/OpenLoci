import { AppError } from './core.js';
import { RecordDatabase } from './db.js';

export async function transferDatabase(source: RecordDatabase, target: RecordDatabase, apply = false) {
  const sourceCount = await source.count();
  const targetCount = await target.count();
  if (targetCount) throw new AppError(409, 'Transfer requires an empty target database; use a separate database for this vault');
  if (!apply) return { preview: true, records: sourceCount, target: target.driver.kind };
  // No concurrent writers during transfer. Preserve hashes and relative vault paths exactly.
  if (target.driver.kind !== 'postgres') throw new AppError(400, 'Transfer target must be PostgreSQL');
  return target.driver.transaction(async driver => {
    const destination = new RecordDatabase(driver);
    if (await destination.count()) throw new AppError(409, 'Target is no longer empty');
    let offset = 0;
    const copiedIds: string[] = [];
    for (;;) {
      const page = await source.search({ limit: 200, offset });
      for (const item of page) { await destination.upsert(item); copiedIds.push(item.record.id); }
      if (page.length < 200) break;
      offset += page.length;
    }
    if (await source.count() !== sourceCount || await destination.count() !== sourceCount) throw new Error('Record count changed during transfer');
    for (const id of copiedIds) {
      const [left, right] = await Promise.all([source.get(id), destination.get(id)]);
      if (!left || !right || JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`Verification failed for ${id}`);
    }
    return { preview: false, copied: copiedIds.length, verified: true, target: target.driver.kind };
  });
}
