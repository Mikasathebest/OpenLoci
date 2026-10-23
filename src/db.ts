import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { recordSchema, type StoredRecord, type MemoryQuery } from './core.js';

export interface SqlDriver {
  kind: 'sqlite' | 'postgres';
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
  transaction<T>(work: (driver: SqlDriver) => Promise<T>): Promise<T>;
}

export class SqliteDriver implements SqlDriver {
  kind = 'sqlite' as const;
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  }
  async query(sql: string, params: unknown[] = []) {
    return this.db.prepare(sql).all(...params as SQLInputValue[]) as Record<string, unknown>[];
  }
  async close() { this.db.close(); }
  async transaction<T>(work: (driver: SqlDriver) => Promise<T>) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await work(this); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

export class PostgresDriver implements SqlDriver {
  kind = 'postgres' as const;
  private pool: pg.Pool;
  constructor(url: string) {
    // pg reads PGSSLROOTCERT and URL sslmode settings; never disable certificate verification here.
    this.pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
  }
  async query(sql: string, params: unknown[] = []) {
    let index = 0;
    return (await this.pool.query(sql.replace(/\?/g, () => `$${++index}`), params)).rows;
  }
  async close() { await this.pool.end(); }
  async transaction<T>(work: (driver: SqlDriver) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const scoped: SqlDriver = {
      kind: 'postgres', close: async () => undefined,
      query: async (sql, params = []) => {
        let index = 0;
        return (await client.query(sql.replace(/\?/g, () => `$${++index}`), params)).rows;
      },
      transaction: async () => { throw new Error('Nested transactions are unsupported'); },
    };
    try {
      await client.query('BEGIN');
      const result = await work(scoped);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

export class RecordDatabase {
  constructor(public driver: SqlDriver) {}
  async initialize() {
    await this.driver.query(`CREATE TABLE IF NOT EXISTS openloci_schema (version INTEGER PRIMARY KEY)`);
    const versions = await this.driver.query('SELECT version FROM openloci_schema ORDER BY version DESC LIMIT 1');
    if (versions.length && Number(versions[0].version) !== 1) throw new Error('Unsupported database schema version');
    await this.driver.query(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, metadata TEXT NOT NULL, hash TEXT NOT NULL, path TEXT NOT NULL,
      source_key TEXT UNIQUE
    )`);
    await this.driver.query('CREATE INDEX IF NOT EXISTS records_date_type ON records(date, type)');
    if (this.driver.kind === 'sqlite') {
      await this.driver.query('CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(id UNINDEXED, title, body)');
      await this.driver.query(`CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
        INSERT INTO records_fts(id,title,body) VALUES(new.id,new.title,new.body); END`);
      await this.driver.query(`CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
        DELETE FROM records_fts WHERE id=old.id; END`);
      await this.driver.query(`CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
        DELETE FROM records_fts WHERE id=old.id;
        INSERT INTO records_fts(id,title,body) VALUES(new.id,new.title,new.body); END`);
    } else {
      await this.driver.query(`CREATE INDEX IF NOT EXISTS records_search ON records
        USING GIN (to_tsvector('simple', title || ' ' || body))`);
    }
    await this.driver.query('INSERT INTO openloci_schema(version) VALUES(1) ON CONFLICT(version) DO NOTHING');
  }
  async upsert(stored: StoredRecord) {
    const { body, ...metadata } = stored.record;
    const source = metadata.source;
    const sourceKey = source.kind === 'import' ? JSON.stringify([source.server_id, source.account_id, source.remote_id]) : null;
    await this.driver.query(`INSERT INTO records(id,type,date,title,body,metadata,hash,path,source_key)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,date=excluded.date,
      title=excluded.title,body=excluded.body,metadata=excluded.metadata,hash=excluded.hash,
      path=excluded.path,source_key=excluded.source_key`, [metadata.id, metadata.type, metadata.date,
      metadata.title, body, JSON.stringify(metadata), stored.hash, stored.path, sourceKey]);
  }
  private decode(row: Record<string, unknown>): StoredRecord {
    return { record: recordSchema.parse({ ...JSON.parse(String(row.metadata)), body: row.body }), hash: String(row.hash), path: String(row.path) };
  }
  async get(id: string) {
    const rows = await this.driver.query('SELECT * FROM records WHERE id=?', [id]);
    return rows[0] ? this.decode(rows[0]) : undefined;
  }
  async search(query: MemoryQuery, includeRestricted = true): Promise<StoredRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    for (const [name, operator, value] of [['type', '=', query.type], ['date', '>=', query.from], ['date', '<=', query.to]] as const) {
      if (value) { where.push(`${name}${operator}?`); params.push(value); }
    }
    if (!includeRestricted) {
      where.push(this.driver.kind === 'sqlite' ? "json_extract(metadata, '$.sensitivity')='standard'" : "metadata::jsonb->>'sensitivity'='standard'");
    }
    if (query.q?.trim()) {
      const terms = query.q.match(/[\p{L}\p{N}_]+/gu) || [];
      if (!terms.length) return [];
      if (this.driver.kind === 'sqlite') {
        where.push('id IN (SELECT id FROM records_fts WHERE records_fts MATCH ?)');
        params.push(terms.map(term => `"${term}"`).join(' AND '));
      } else {
        where.push("to_tsvector('simple', title || ' ' || body) @@ plainto_tsquery('simple', ?)");
        params.push(terms.join(' '));
      }
    }
    params.push(query.limit, query.offset);
    const rows = await this.driver.query(`SELECT * FROM records ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id LIMIT ? OFFSET ?`, params);
    return rows.map(row => this.decode(row));
  }
  async remove(id: string) { await this.driver.query('DELETE FROM records WHERE id=?', [id]); }
  async count() { return Number((await this.driver.query('SELECT count(*) AS count FROM records'))[0].count); }
  async close() { await this.driver.close(); }
}

export async function openDatabase(vault: string, url?: string) {
  const path = join(vault, '.openloci', 'index.sqlite');
  if (!url) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (url && !/^postgres(ql)?:\/\//.test(url)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  const db = new RecordDatabase(url ? new PostgresDriver(url) : new SqliteDriver(path));
  try { await db.initialize(); } catch (error) { await db.close(); throw error; }
  return db;
}
