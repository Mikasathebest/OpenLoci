import { mkdir, readFile, readdir, realpath, lstat, rename, open } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { AppError, hash, recordSchema, type MemoryRecord, type StoredRecord } from './core.js';

export function parseMarkdown(content: string): MemoryRecord {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!match) throw new AppError(422, 'Record must have YAML frontmatter');
  const metadata = YAML.parse(match[1], { maxAliasCount: 0, uniqueKeys: true });
  return recordSchema.parse({ ...metadata, body: match[2].replace(/^\r?\n/, '') });
}
export function serialize(record: MemoryRecord) {
  const { body, ...metadata } = record;
  return `---\n${YAML.stringify(metadata)}---\n\n${body}`;
}

export class Vault {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  async initialize() { await mkdir(this.root, { recursive: true, mode: 0o700 }); }
  async safePath(path: string, createParent = false) {
    const absolute = resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new AppError(400, 'Path outside vault');
    const root = await realpath(this.root);
    let current = this.root;
    for (const segment of rel.split('/')) {
      current = join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink()) throw new AppError(400, 'Symlinks are not supported in vault paths');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (createParent) await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(absolute));
    const parentRel = relative(root, parent);
    if (parentRel.startsWith('..') || isAbsolute(parentRel)) throw new AppError(400, 'Path outside vault');
    return absolute;
  }
  async read(path: string): Promise<StoredRecord> {
    const content = await readFile(await this.safePath(path), 'utf8');
    return { record: parseMarkdown(content), hash: hash(content), path };
  }
  async write(record: MemoryRecord, existing?: { path: string; expectedHash: string }): Promise<StoredRecord> {
    const path = existing?.path || `records/${record.type}/${record.date.slice(0, 4)}/${record.date.slice(5, 7)}/${record.id}.md`;
    const absolute = await this.safePath(path, true);
    let old: string | undefined;
    try { old = await readFile(absolute, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (existing ? old === undefined || hash(old) !== existing.expectedHash : old !== undefined) throw new AppError(409, 'Record changed; reload before saving');
    const content = serialize(record);
    const temporary = `${absolute}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    // App writers are serialized; external editors still require a final revision check.
    if (old !== undefined) {
      if (hash(await readFile(absolute, 'utf8')) !== existing?.expectedHash) throw new AppError(409, 'Record changed during save');
      const history = await this.safePath(`.openloci/history/${record.id}/${hash(old)}.md`, true);
      const backup = await open(history, 'w', 0o600);
      try { await backup.writeFile(old); await backup.sync(); } finally { await backup.close(); }
    }
    await rename(temporary, absolute);
    return { record, hash: hash(content), path };
  }
  async *files(directory = 'records'): AsyncGenerator<string> {
    const target = join(this.root, directory);
    let entries;
    try { entries = await readdir(target, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) yield* this.files(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) yield path;
    }
  }
}
