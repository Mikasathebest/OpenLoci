import express from 'express';
import { ZodError } from 'zod';
import { Application } from './application.js';
import { AppError, querySchema } from './core.js';
import { McpManager } from './integrations/mcp.js';
import { importCalendar, importNotion } from './integrations/imports.js';
import { browserScript, page, recordPage, stylesheet } from './web.js';

export function createHttpApp(app: Application, mcp: McpManager) {
  const http = express();
  http.disable('x-powered-by');
  http.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) { res.status(403).json({ error: 'Only loopback hosts are allowed' }); return; }
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) { res.status(403).json({ error: 'Cross-origin requests are forbidden' }); return; }
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !req.is('application/json')) { res.status(415).json({ error: 'Use application/json' }); return; }
    next();
  });
  http.use(express.json({ limit: '2mb' }));
  http.get('/api/health', (_req, res) => { res.json({ status: 'ok', version: '0.1.0', database: app.db.driver.kind }); });
  http.get('/api/records', async (req, res) => { res.json(await app.search(req.query)); });
  http.get('/api/records/:id', async (req, res) => { const item = await app.get(req.params.id); res.set('ETag', `"${item.hash}"`).json(item); });
  http.post('/api/records', async (req, res) => { res.status(201).json(await app.create(req.body)); });
  http.patch('/api/records/:id', async (req, res) => {
    const expected = req.headers['if-match'];
    if (typeof expected !== 'string') throw new AppError(428, 'If-Match revision header is required');
    res.json(await app.update(req.params.id, req.body, expected.replace(/^"|"$/g, '')));
  });
  http.get('/api/integrations', async (_req, res) => { res.json(await mcp.status()); });
  http.post('/api/imports/notion', async (req, res) => { res.json(await importNotion(app, mcp, req.body)); });
  http.post('/api/imports/calendar', async (req, res) => { res.json(await importCalendar(app, mcp, req.body)); });
  http.post('/api/rebuild', async (_req, res) => { const result = await app.rebuild(); res.status(result.errors.length ? 422 : 200).json(result); });
  http.get('/assets/style.css', (_req, res) => { res.type('css').send(stylesheet); });
  http.get('/assets/app.js', (_req, res) => { res.type('js').send(browserScript); });
  http.get('/', async (req, res) => {
    const input = Object.fromEntries(Object.entries(req.query).filter(([, value]) => value !== ''));
    const query = querySchema.parse(input);
    res.type('html').send(page(await app.search(query), query, app.db.driver.kind, app.validationErrors.length));
  });
  http.get('/records/:id', async (req, res) => { res.type('html').send(recordPage(await app.get(req.params.id))); });
  http.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  http.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 :
      (error as { type?: string })?.type === 'entity.parse.failed' ? 400 :
      (error as { type?: string })?.type === 'entity.too.large' ? 413 : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500;
    res.status(status).json({ error: error instanceof AppError ? error.message : error instanceof ZodError ? 'Invalid input: ' + error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : status === 400 ? 'Invalid JSON' : status === 413 ? 'Request too large' : status === 404 ? 'Record file not found' : 'Operation failed; check local configuration and server logs' });
    if (status >= 500) console.error('Operation failed:', error instanceof Error ? error.name : 'UnknownError');
  });
  return http;
}
