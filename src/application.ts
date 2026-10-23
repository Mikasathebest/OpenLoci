import { randomUUID } from 'node:crypto';
import { AppError, hash, querySchema, recordSchema, type MemoryRecord, type StoredRecord } from './core.js';
import { RecordDatabase, openDatabase } from './db.js';
import { Vault } from './vault.js';
import { CustomPageStore } from './custom-pages.js';

export function importFingerprint(record: MemoryRecord) {
  return hash(JSON.stringify([record.title, record.date, record.timezone, record.body, record.attributes]));
}

export class Application {
  validationErrors: { path: string; error: string }[] = [];
  private pending: Promise<unknown> = Promise.resolve();
  readonly pages: CustomPageStore;
  constructor(public vault: Vault, public db: RecordDatabase, public timezone: string) { this.pages = new CustomPageStore(vault); }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.pending.then(work);
    this.pending = task.catch(() => undefined);
    return task;
  }
  async get(id: string, includeRestricted = true): Promise<StoredRecord> {
    const indexed = await this.db.get(id);
    if (!indexed) throw new AppError(404, 'Record not found');
    const current = await this.vault.read(indexed.path);
    if (current.record.id !== id) throw new AppError(409, 'Record identity changed; rebuild the index');
    if (!includeRestricted && current.record.sensitivity === 'restricted') throw new AppError(404, 'Record not found');
    return current;
  }
  async create(input: unknown): Promise<StoredRecord> {
    return this.exclusive(async () => {
      const now = new Date().toISOString();
      const record = recordSchema.parse({ id: randomUUID(), timezone: this.timezone, created_at: now, updated_at: now,
        ...this.object(input) });
      if (await this.db.get(record.id)) throw new AppError(409, 'Record ID already exists');
      return this.persist(record);
    });
  }
  private object(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Expected a JSON object');
    return input as Record<string, unknown>;
  }
  async update(id: string, patch: unknown, expectedHash: string) {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!expectedHash || current.hash !== expectedHash) throw new AppError(409, 'Expected revision does not match');
      const changes = this.object(patch);
      if (changes.id !== undefined && changes.id !== id) throw new AppError(400, 'Record identity is immutable');
      const record = recordSchema.parse({ ...current.record, ...changes, id,
        created_at: current.record.created_at, updated_at: new Date().toISOString() });
      return this.persist(record, { path: current.path, expectedHash });
    });
  }
  private async persist(record: MemoryRecord, existing?: { path: string; expectedHash: string }) {
    if (record.page_id) await this.pages.get(record.page_id);
    const stored = await this.vault.write(record, existing);
    try { await this.db.upsert(stored); } catch {
      throw new AppError(503, `Markdown saved for ${record.id}; database indexing failed. Run rebuild before retrying.`);
    }
    return stored;
  }
  async completePageRecord(pageId: string, recordId: string, completed: boolean, expectedHash: string) {
    const page = await this.pages.get(pageId);
    if (page.page.layout !== 'checklist') throw new AppError(400, 'Page is not a checklist');
    const current = await this.get(recordId);
    if (current.record.page_id !== pageId) throw new AppError(404, 'Record not found on this page');
    return this.update(recordId, { attributes: { ...current.record.attributes, completed } }, expectedHash);
  }
  async search(input: unknown, includeRestricted = true) {
    const query = querySchema.parse(input);
    const results = await this.db.search(query, includeRestricted);
    // Read current files so manual edits cannot leak newly restricted or deleted content through stale indexes.
    const current: StoredRecord[] = [];
    for (const item of results) {
      try { const record = await this.get(item.record.id, includeRestricted); if (!query.page_id || record.record.page_id === query.page_id) current.push(record); }
      catch (error) { if ((error instanceof AppError && error.status === 404) || (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    }
    return current;
  }
  async rebuild() {
    return this.exclusive(async () => {
      const seen = new Set<string>();
      const records: StoredRecord[] = [];
      const errors: { path: string; error: string }[] = [];
      for await (const path of this.vault.files()) {
        try {
          const stored = await this.vault.read(path);
          if (seen.has(stored.record.id)) throw new Error(`Duplicate record ID ${stored.record.id}`);
          seen.add(stored.record.id); records.push(stored);
        } catch (error) { errors.push({ path, error: (error as Error).message }); }
      }
      // Refuse a partial rebuild: an invalid file must not silently disappear from queries.
      this.validationErrors = errors;
      if (errors.length) return { indexed: 0, errors };
      await this.db.driver.transaction(async driver => {
      const projection = new RecordDatabase(driver);
      for (const stored of records) await projection.upsert(stored);
      let offset = 0;
      const oldIds: string[] = [];
      for (;;) {
        const page = await projection.search({ limit: 200, offset });
        oldIds.push(...page.map(item => item.record.id));
        if (page.length < 200) break;
        offset += page.length;
      }
      for (const id of oldIds) if (!seen.has(id)) await projection.remove(id);
      });
      return { indexed: records.length, errors };
    });
  }
  async importRecord(candidate: MemoryRecord) {
    return this.exclusive(async () => {
      const existing = await this.db.get(candidate.id);
      const remote = importFingerprint(candidate);
      if (existing) {
        const current = await this.get(candidate.id);
        const baseline = current.record.source.imported_fingerprint;
        if (remote === baseline) return { status: 'unchanged', record: current };
        if (importFingerprint(current.record) !== baseline) throw new AppError(409, `Local edits conflict with remote changes for ${candidate.id}`);
        const record = recordSchema.parse({ ...current.record, title: candidate.title, body: candidate.body,
          date: candidate.date, timezone: candidate.timezone, attributes: candidate.attributes,
          updated_at: new Date().toISOString(), source: { ...candidate.source, imported_fingerprint: remote } });
        return { status: 'updated', record: await this.persist(record, { path: current.path, expectedHash: current.hash }) };
      }
      candidate.source = { ...candidate.source, imported_fingerprint: remote };
      return { status: 'created', record: await this.persist(candidate) };
    });
  }
  async close() { await this.pending; await this.db.close(); }
}

export async function openApplication(settings: { vault: string; databaseUrl?: string; timezone: string }) {
  const vault = new Vault(settings.vault);
  await vault.initialize();
  const db = await openDatabase(settings.vault, settings.databaseUrl);
  const app = new Application(vault, db, settings.timezone);
  try {
    const result = await app.rebuild();
    if (result.errors.length) console.error('Vault validation errors:', JSON.stringify(result.errors));
  } catch (error) { await app.close(); throw error; }
  return app;
}
