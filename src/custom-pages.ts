import { randomUUID } from 'node:crypto';
import { readFile, open, rename, unlink } from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';
import { Vault } from './vault.js';
import { AppError, hash } from './core.js';

export const pageLayouts = ['notes', 'checklist', 'table'] as const;
export const newPageSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).default(''),
  layout: z.enum(pageLayouts).default('notes'),
}).strict();
export const customPageSchema = newPageSchema.extend({
  schema_version: z.literal(1), id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
}).passthrough();
export type CustomPage = z.infer<typeof customPageSchema>;
export type StoredPage = { page: CustomPage; hash: string; path: string };

export class CustomPageStore {
  constructor(private vault: Vault) {}
  async create(input: unknown): Promise<StoredPage> {
    const page = customPageSchema.parse({ ...newPageSchema.parse(input), schema_version: 1, id: randomUUID(), created_at: new Date().toISOString() });
    const { description, ...metadata } = page;
    const content = `---\n${YAML.stringify(metadata)}---\n\n${description}\n`;
    const path = `pages/${page.id}.md`;
    const destination = await this.vault.safePath(path, true);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    try { await rename(temporary, destination); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    return { page, path, hash: hash(content) };
  }
  async get(id: string): Promise<StoredPage> {
    z.string().uuid().parse(id);
    const path = `pages/${id}.md`;
    try {
      const content = await readFile(await this.vault.safePath(path), 'utf8');
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
      if (!match) throw new AppError(422, 'Page must have YAML frontmatter');
      const page = customPageSchema.parse({ ...YAML.parse(match[1], { maxAliasCount: 0, uniqueKeys: true }), description: match[2].trim() });
      if (page.id !== id) throw new AppError(409, 'Page identity does not match its file name');
      return { page, path, hash: hash(content) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError(404, 'Page not found');
      throw error;
    }
  }
  async list(): Promise<StoredPage[]> {
    const pages = [];
    for await (const path of this.vault.files('pages')) {
      const id = path.slice('pages/'.length, -'.md'.length);
      pages.push(await this.get(id));
    }
    return pages.sort((a, b) => a.page.created_at.localeCompare(b.page.created_at) || a.page.id.localeCompare(b.page.id));
  }
}
