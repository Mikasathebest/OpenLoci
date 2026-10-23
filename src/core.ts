import { createHash } from 'node:crypto';
import { z } from 'zod';

export const types = ['journal', 'event', 'meal', 'exercise', 'expense', 'travel', 'profile', 'memory'] as const;
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const timestamp = z.string().datetime({ offset: true });
const sourceSchema = z.object({ kind: z.enum(['manual', 'import', 'generated']) }).passthrough().superRefine((source, ctx) => {
  if (source.kind !== 'import') return;
  for (const key of ['server_id', 'account_id', 'remote_id']) {
    if (typeof source[key] !== 'string' || !source[key]) ctx.addIssue({ code: 'custom', message: `Imported records require ${key}`, path: [key] });
  }
});
export const recordSchema = z.object({
  schema_version: z.literal(1).default(1),
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  type: z.enum(types),
  title: z.string().trim().min(1).max(500),
  date: dateSchema,
  timezone: z.string().refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Invalid IANA timezone'),
  created_at: timestamp,
  updated_at: timestamp,
  visibility: z.enum(['private', 'shareable']).default('private'),
  sensitivity: z.enum(['standard', 'restricted']).default('standard'),
  tags: z.array(z.string().max(100)).max(100).default([]),
  links: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)).default([]),
  source: sourceSchema.default({ kind: 'manual' }),
  attributes: z.record(z.unknown()).default({}),
  body: z.string().max(1_000_000).default(''),
}).passthrough().superRefine((record, ctx) => {
  if (record.type === 'expense') {
    if (!Number.isSafeInteger(record.attributes.amount_minor)) ctx.addIssue({ code: 'custom', message: 'Expenses require integer amount_minor', path: ['attributes', 'amount_minor'] });
    if (typeof record.attributes.currency !== 'string' || !/^[A-Z]{3}$/.test(record.attributes.currency)) ctx.addIssue({ code: 'custom', message: 'Expenses require a three-letter currency', path: ['attributes', 'currency'] });
  }
  if (record.type === 'exercise' && record.attributes.duration_seconds !== undefined &&
      (typeof record.attributes.duration_seconds !== 'number' || record.attributes.duration_seconds < 0)) {
    ctx.addIssue({ code: 'custom', message: 'duration_seconds must be nonnegative', path: ['attributes', 'duration_seconds'] });
  }
});
export type MemoryRecord = z.infer<typeof recordSchema>;
export const querySchema = z.object({
  q: z.string().max(500).optional(), type: z.enum(types).optional(),
  from: dateSchema.optional(), to: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).refine(q => !q.from || !q.to || q.from <= q.to, 'from must be before to');
export type MemoryQuery = z.infer<typeof querySchema>;
export type StoredRecord = { record: MemoryRecord; hash: string; path: string };
export function hash(content: string): string { return createHash('sha256').update(content).digest('hex'); }
export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
