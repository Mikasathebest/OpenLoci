import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { z } from 'zod';
import { Application } from './application.js';
import { AppError, dateSchema, hash, recordSchema, type MemoryRecord, type StoredRecord } from './core.js';
import { parse } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import { simpleParser } from 'mailparser';

export const domainTypes = ['journal', 'event', 'meal', 'exercise', 'expense', 'travel'] as const;
export type DomainType = typeof domainTypes[number];
export function localDay(timezone: string, value = new Date()) {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).map(p => [p.type, p.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
export function instant(date: string, time: string, timezone: string) {
  dateSchema.parse(date); z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).parse(time);
  const target = Date.parse(`${date}T${time}:00Z`); let current = target;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  for (let i = 0; i < 4; i++) {
    const f = Object.fromEntries(formatter.formatToParts(current).map(p => [p.type, p.value]));
    const displayed = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second);
    if (displayed === target) return new Date(current).toISOString();
    current += target - displayed;
  }
  throw new AppError(400, 'This local time does not exist in the selected timezone');
}
export async function allRecords(app: Application, type: MemoryRecord['type'], from?: string, to?: string) {
  const records: StoredRecord[] = [];
  for (let offset = 0; ; offset += 200) {
    const indexed = await app.db.search({ type, from, to, limit: 200, offset });
    for (const item of indexed) {
      try { const current = await app.get(item.record.id); if (current.record.type === type && (!from || current.record.date >= from) && (!to || current.record.date <= to)) records.push(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (records.length > 20_000) throw new AppError(413, 'Choose a shorter date range');
    if (indexed.length < 200) return records;
  }
}

export const calendarInput = z.object({ title: z.string().trim().min(1).max(500), date: dateSchema, time: z.string().default('09:00'),
  duration: z.number().int().min(1).max(43200).default(30), kind: z.enum(['event', 'task', 'meeting']).default('event'),
  all_day: z.boolean().default(false), end_date: dateSchema.optional(),
  timezone: z.string().optional(), body: z.string().max(100_000).default(''), location: z.string().max(500).default(''),
  attendees: z.string().max(2000).default(''), id: z.string().optional(), hash: z.string().optional(),
});
export async function saveCalendar(app: Application, input: unknown) {
  const data = calendarInput.parse(input), timezone = data.timezone || app.timezone;
  const start = instant(data.date, data.time, timezone), end = new Date(+new Date(start) + data.duration * 60_000).toISOString();
  if (data.all_day && (!data.end_date || data.end_date <= data.date)) throw new AppError(400, 'All-day end date must be after the start (exclusive)');
  const existing = data.id ? await app.get(data.id) : undefined;
  if (existing && existing.record.type !== 'event') throw new AppError(400, 'Not a calendar record');
  const attributes = { ...existing?.record.attributes };
  for (const key of ['start_at', 'end_at', 'start_date', 'end_date', 'duration_minutes', 'all_day']) delete attributes[key];
  const value = { type: 'event', title: data.title, date: data.date, timezone, body: data.body,
    attributes: { ...attributes, kind: data.kind, ...(data.all_day ? { all_day: true, start_date: data.date, end_date: data.end_date } : { all_day: false, start_at: start, end_at: end, duration_minutes: data.duration }),
      location: data.location, attendees: data.attendees.split(',').map(value => value.trim()).filter(Boolean), activity_state: 'scheduled' } };
  return existing ? app.update(existing.record.id, value, data.hash || '') : app.create(value);
}

export class MediaStore {
  constructor(private app: Application) {}
  async upload(input: unknown) {
    const data = z.object({ data: z.string().max(12_000_000) }).parse(input);
    const bytes = Buffer.from(data.data, 'base64');
    if (bytes.length < 12 || bytes.length > 8_000_000) throw new AppError(400, 'Photo must be between 12 bytes and 8 MB');
    const mime = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg' : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined;
    if (!mime) throw new AppError(400, 'Use a JPEG, PNG or WebP photo');
    const id = hash(bytes.toString('base64')) + '.' + ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime]);
    const path = await this.app.vault.safePath(`attachments/media/${id}`, true);
    await writeFile(path, bytes, { mode: 0o600 });
    return { id, url: `/media/${id}`, mime };
  }
  async get(id: string) {
    z.string().regex(/^[a-f0-9]{64}\.(jpg|png|webp)$/).parse(id);
    return readFile(await this.app.vault.safePath(`attachments/media/${id}`));
  }
}

export { recognitionReady, recognize } from './integrations/recognition.js';

export const mealInput = z.object({ title: z.string().trim().min(1).max(500), date: dateSchema, time: z.string(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']), body: z.string().max(100_000).default(''),
  photo: z.string().optional(), calories: z.number().min(0).max(30_000).nullable().optional(), sync_calendar: z.boolean().default(true),
});
export async function saveMeal(app: Application, input: unknown) {
  const data = mealInput.parse(input);
  if (data.photo) await new MediaStore(app).get(data.photo);
  const eaten = instant(data.date, data.time, app.timezone);
  const meal = await app.create({ type: 'meal', title: data.title, date: data.date, body: data.body, attributes: {
    eaten_at: eaten, meal_type: data.meal_type, ...(data.photo ? { photo_id: data.photo } : {}),
    ...(data.calories != null ? { calories: data.calories, nutrition_source: 'user_reviewed_estimate' } : {}),
  } });
  let synced = false;
  if (data.sync_calendar) {
    try {
      await app.create({ id: `meal-${meal.record.id}`, type: 'event', title: data.title, date: data.date, links: [meal.record.id], body: data.body,
        attributes: { start_at: eaten, end_at: new Date(+new Date(eaten) + 30 * 60_000).toISOString(), kind: 'meal', linked_record_id: meal.record.id, activity_state: 'recorded' } });
      synced = true;
    } catch { /* Return an explicit sync outcome rather than losing the durable meal. */ }
  }
  return { ...meal, calendar_synced: synced };
}

function finite(value: unknown, fallback = 0) { const number = Number(value); if (!Number.isFinite(number)) throw new AppError(400, 'Invalid numeric value'); return value == null || value === '' ? fallback : number; }
export function minorUnits(amount: unknown, currency: string) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  const value = String(amount).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new AppError(400, 'Invalid amount');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) throw new AppError(400, 'Amount has too many decimal places for its currency');
  const result = (Number(whole) * 10 ** digits + Number(fraction.slice(0, digits).padEnd(digits, '0'))) * (value.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(result)) throw new AppError(400, 'Amount is out of range');
  return result;
}
export async function saveExpense(app: Application, input: unknown) {
  const data = z.object({ title: z.string().trim().min(1).max(500), date: dateSchema, amount: z.union([z.string(), z.number()]),
    currency: z.string().regex(/^[A-Z]{3}$/), category: z.string().max(100).default('Other'), direction: z.enum(['expense', 'income', 'budget']).default('expense'), body: z.string().default('') }).parse(input);
  const value = { type: 'expense', title: data.title, date: data.date, body: data.body, attributes: {
    amount_minor: minorUnits(data.amount, data.currency), currency: data.currency, category: data.category, direction: data.direction,
  } };
  if (data.direction === 'budget') {
    const id = `budget-${data.date.slice(0, 7)}-${data.currency}-${hash(data.category).slice(0, 12)}`;
    const existing = await app.db.get(id);
    return existing ? app.update(id, value, (await app.get(id)).hash) : app.create({ ...value, id });
  }
  return app.create(value);
}
export function expenseSummary(records: StoredRecord[], month: string, currency: string) {
  const selected = records.filter(item => item.record.attributes.currency === currency);
  const monthly = selected.filter(item => item.record.date.startsWith(month));
  const sum = (items: StoredRecord[], direction: string) => items.filter(item => (item.record.attributes.direction || 'expense') === direction).reduce((total, item) => total + Number(item.record.attributes.amount_minor), 0);
  const categories: Record<string, number> = Object.create(null);
  for (const item of monthly) if (!['income', 'budget'].includes(String(item.record.attributes.direction))) {
    const category = String(item.record.attributes.category || 'Other'); categories[category] = (categories[category] || 0) + Number(item.record.attributes.amount_minor);
  }
  const months = [...new Set(selected.filter(item => item.record.attributes.direction !== 'budget').map(item => item.record.date.slice(0, 7)))].sort().reverse();
  return { income: sum(monthly, 'income'), expense: sum(monthly, 'expense'), budget: sum(monthly, 'budget'), categories,
    months: months.map(value => ({ month: value, income: sum(selected.filter(item => item.record.date.startsWith(value)), 'income'), expense: sum(selected.filter(item => item.record.date.startsWith(value)), 'expense') })),
    records: monthly.filter(item => item.record.attributes.direction !== 'budget') };
}

function importedFile(type: 'exercise' | 'expense', source: string, remoteId: string, data: Record<string, unknown>): MemoryRecord {
  const now = new Date().toISOString();
  return recordSchema.parse({ id: `file-${hash(JSON.stringify([type, source, remoteId])).slice(0, 40)}`, type, timezone: 'UTC', created_at: now, updated_at: now,
    source: { kind: 'import', server_id: `${type}-file`, account_id: source, remote_id: remoteId }, ...data });
}
function rowsFromFile(text: string, filename: string) {
  let rows: unknown;
  try { rows = filename.toLowerCase().endsWith('.json') ? JSON.parse(text) : parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: true, max_record_size: 100_000 }); }
  catch { throw new AppError(400, 'Invalid CSV or JSON file'); }
  return z.array(z.record(z.string(), z.unknown())).max(10_000).parse(rows);
}
export function parseDataFile(kind: 'exercise' | 'expense', text: string, filename: string, timezone: string) {
  if (Buffer.byteLength(text) > 15_000_000) throw new AppError(413, 'Use a data file smaller than 15 MB');
  if (kind === 'exercise' && filename.toLowerCase().endsWith('.xml')) return parseHealthXml(text, timezone);
  const rows = rowsFromFile(text, filename), fileId = hash(text), records: MemoryRecord[] = [], warnings: string[] = [];
  rows.forEach((row, index) => {
    try {
      const date = String(row.date || row['日期'] || row['交易时间'] || '').slice(0, 10); dateSchema.parse(date);
      const title = String(row.title || row['备注'] || row.merchant || row.activity || row['交易对方'] || kind);
      const source = String(row.source || 'local-file');
      const remote = String(row.id || `${fileId}:${index}`);
      if (kind === 'expense') {
        const currency = String(row.currency || 'CNY').toUpperCase();
        const direction = String(row.direction || row['收/支'] || 'expense');
        if (!['income', 'expense', '收入', '支出'].includes(direction)) throw new Error('Unsupported transaction direction');
        const attrs = { amount_minor: row.amount_minor !== undefined ? finite(row.amount_minor) : minorUnits(row.amount || row['金额'] || row['金额(元)'], currency), currency,
          direction: ['income', '收入'].includes(direction) ? 'income' : 'expense', category: String(row.category || row['交易分类'] || 'Other') };
        records.push(importedFile(kind, source, remote, { title, date, timezone, body: '', attributes: attrs }));
      } else {
        const duration = row.duration_seconds !== undefined ? finite(row.duration_seconds) : finite(row.duration_minutes) * 60;
        const attrs = { activity: String(row.activity || 'Workout'), duration_seconds: duration, source_name: source,
          ...(row.steps != null ? { steps: finite(row.steps) } : {}), ...(row.calories != null ? { active_energy_kcal: finite(row.calories) } : {}),
          ...(row.distance_meters != null ? { distance_meters: finite(row.distance_meters) } : {}) };
        if (duration < 0 || Object.values(attrs).some(value => typeof value === 'number' && value < 0)) throw new Error('Negative measurement');
        records.push(importedFile(kind, source, remote, { title, date, timezone, body: '', attributes: attrs }));
      }
    } catch { warnings.push(`row:${index + 1}`); }
  });
  return { records, warnings };
}

export function parseHealthXml(text: string, timezone: string) {
  if (/<!ENTITY|\bSYSTEM\s+["']|\bPUBLIC\s+["']/i.test(text)) throw new AppError(400, 'External XML entities are not supported');
  const data = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', processEntities: false }).parse(text);
  if (!data.HealthData) throw new AppError(400, 'Not an Apple Health export');
  const list = (value: unknown) => value == null ? [] : Array.isArray(value) ? value : [value];
  const records: MemoryRecord[] = [], warnings: string[] = [];
  const items = [...list(data.HealthData.Workout).map(row => ({ ...row, workout: true })), ...list(data.HealthData.Record)];
  if (items.length > 100_000) throw new AppError(413, 'Export a smaller date range');
  for (const row of items) {
    try {
      const source = String(row.sourceName || 'Apple Health'), start = new Date(String(row.startDate).replace(' ', 'T').replace(' ', ''));
      if (Number.isNaN(+start)) throw new Error('Invalid date');
      const type = row.workout ? 'workout' : String(row.type).replace('HKQuantityTypeIdentifier', '').replace('HKCategoryTypeIdentifier', '');
      if (!row.workout && !['StepCount', 'ActiveEnergyBurned', 'AppleExerciseTime', 'HeartRate', 'AppleStandHour'].includes(type)) continue;
      const attributes: Record<string, unknown> = { source_name: source, started_at: start.toISOString(), measurement_type: type };
      if (row.workout) {
        attributes.activity = String(row.workoutActivityType || 'Workout').replace('HKWorkoutActivityType', '');
        if (!['min', 's'].includes(row.durationUnit)) throw new Error('Unsupported duration unit');
        attributes.duration_seconds = finite(row.duration) * (row.durationUnit === 'min' ? 60 : 1);
      } else if (type === 'StepCount' && row.unit === 'count') attributes.steps = finite(row.value);
      else if (type === 'ActiveEnergyBurned' && ['kcal', 'kJ'].includes(row.unit)) attributes.active_energy_kcal = finite(row.value) / (row.unit === 'kJ' ? 4.184 : 1);
      else if (type === 'AppleExerciseTime' && row.unit === 'min') attributes.exercise_minutes = finite(row.value);
      else if (type === 'HeartRate' && row.unit === 'count/min') attributes.heart_rate_bpm = finite(row.value);
      else if (type === 'AppleStandHour') attributes.stand_hour = String(row.value).includes('Stood') || String(row.value) === '0' ? start.toISOString().slice(0, 13) : null;
      else throw new Error('Unsupported unit');
      if (Object.values(attributes).some(value => typeof value === 'number' && value < 0)) throw new Error('Negative measurement');
      const id = String(row.uuid || hash(JSON.stringify([source, row.type || row.workoutActivityType, row.startDate, row.endDate])));
      records.push(importedFile('exercise', source, id, { title: String(attributes.activity || type), date: localDay(timezone, start), timezone, body: '', attributes }));
    } catch { warnings.push('Unsupported health row'); }
  }
  return { records, warnings };
}

export const travelInput = z.object({ title: z.string().trim().min(1).max(500), date: dateSchema, time: z.string().default('09:00'),
  city: z.string().trim().max(200).default(''), place: z.string().trim().max(300).default(''), kind: z.enum(['attraction', 'flight', 'hotel', 'transport']).default('attraction'),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
  id: z.string().optional(), hash: z.string().optional(), end_date: dateSchema.optional(), body: z.string().max(100_000).default(''),
});
export async function saveTravel(app: Application, input: unknown) {
  const data = travelInput.parse(input);
  if (data.end_date && data.end_date < data.date) throw new AppError(400, 'End date is before start date');
  const existing = data.id ? await app.get(data.id) : undefined;
  if (existing && existing.record.type !== 'travel') throw new AppError(400, 'Not a travel record');
  const value = { type: 'travel', title: data.title, date: data.date, body: data.body,
    attributes: { city: data.city, place: data.place, kind: data.kind, start_at: instant(data.date, data.time, app.timezone),
      latitude: data.latitude, longitude: data.longitude, end_date: data.end_date, booking_status: 'planned' } };
  return existing ? app.update(existing.record.id, value, data.hash || '') : app.create(value);
}
export async function emailText(content: string, filename = '') {
  if (Buffer.byteLength(content) > 2_000_000) throw new AppError(413, 'Email is too large');
  if (filename.endsWith('.eml') || /^From:|^MIME-Version:/mi.test(content)) {
    const message = await simpleParser(content, { skipHtmlToText: false, skipImageLinks: true, maxHtmlLengthToParse: 1_000_000 });
    return [message.subject || '', message.text || ''].join('\n').slice(0, 100_000);
  }
  return content.slice(0, 100_000);
}
export function parseTravelEmail(text: string) {
  const dates = [...new Set(text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [])].filter(date => dateSchema.safeParse(date).success);
  const flight = /(?:flight|航班)[\s:：]*([A-Z\d]{2}\s?\d{2,4})/i.exec(text);
  const hotel = /(?:hotel|酒店)[\s:：]*([^\n\r]{2,100})/i.exec(text);
  return { title: flight ? `Flight ${flight[1]}` : hotel ? hotel[1].trim() : '', kind: flight ? 'flight' : hotel ? 'hotel' : 'transport',
    date: dates[0] || '', end_date: hotel ? dates[1] || '' : '', city: '', place: hotel?.[1]?.trim() || '', body: text, needs_review: true };
}
export async function receiveEmail(app: Application, input: unknown, authorization?: string) {
  const token = process.env.OPENLOCI_MAIL_WEBHOOK_TOKEN;
  if (!token) throw new AppError(409, 'Email forwarding is not configured');
  const actual = Buffer.from(authorization || ''), expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError(401, 'Unauthorized');
  const body = z.object({ content: z.string().max(2_000_000), filename: z.string().default('forwarded.eml') }).parse(input);
  const id = randomUUID(), text = await emailText(body.content, body.filename);
  await writeFile(await app.vault.safePath(`inbox/travel/${id}.txt`, true), text, { mode: 0o600 });
  return { id, received: true, requires_review: true };
}
export async function inbox(app: Application) {
  let names: string[];
  try { names = await readdir(await app.vault.safePath('inbox/travel/index.txt', true).then(path => path.slice(0, -'index.txt'.length))); } catch { return []; }
  return Promise.all(names.filter(name => /^[a-f\d-]{36}\.txt$/.test(name)).slice(-100).map(async name => ({ id: name.slice(0, -4), text: await readFile(await app.vault.safePath(`inbox/travel/${name}`), 'utf8') })));
}
