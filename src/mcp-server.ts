import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openApplication, type Application } from './application.js';
import { config } from './config.js';
import { types } from './core.js';

export function createMemoryServer(app: Application) {
  const server = new McpServer({ name: 'openloci', version: '0.1.0' });
  const query = { q: z.string().max(500).optional(), type: z.enum(types).optional(), page_id: z.string().uuid().optional(), from: z.string().optional(), to: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) };
  function result(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }; }
  server.registerTool('memory_search', { description: 'Search standard-sensitivity memory records, with IDs and revision hashes.', inputSchema: query },
    async input => result(await app.search(input, false)));
  server.registerTool('memory_get', { description: 'Read one standard-sensitivity record by stable ID.', inputSchema: { id: z.string() } },
    async input => result(await app.get(input.id, false)));
  server.registerTool('memory_context', { description: 'Build bounded JSON context with evidence IDs and source revisions. Budget is UTF-8 bytes.', inputSchema: {
    ...query, maxBytes: z.number().int().min(512).max(64_000).default(12_000),
  } }, async input => {
    const records = await app.search(input, false);
    const context: { budgetBytes: number; truncated: boolean; evidence: unknown[] } = { budgetBytes: input.maxBytes, truncated: true, evidence: [] };
    for (const item of records) {
      const excerpt = { id: item.record.id, revision: item.hash, date: item.record.date,
        title: item.record.title, body: item.record.body.slice(0, 1200) };
      context.evidence.push(excerpt);
      if (Buffer.byteLength(JSON.stringify(context)) > input.maxBytes) { context.evidence.pop(); break; }
    }
    context.truncated = context.evidence.length < records.length || records.some(item => item.record.body.length > 1200) || records.length === input.limit;
    return result(context);
  });
  // Capture is opt-in at process startup; the default MCP surface is read-only.
  if (process.env.OPENLOCI_MCP_WRITE === '1') server.registerTool('record_create', { description: 'Create a standard-sensitivity record in the local vault.', inputSchema: {
    type: z.enum(types), title: z.string().min(1).max(500), date: z.string(), body: z.string(), attributes: z.record(z.string(), z.unknown()).optional(),
  } }, async input => result(await app.create({ ...input, sensitivity: 'standard' })));
  return server;
}

if (process.argv[1] && /mcp-server\.(ts|js)$/.test(process.argv[1])) {
  const app = await openApplication(config());
  const server = createMemoryServer(app);
  await server.connect(new StdioServerTransport());
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await server.close(); await app.close(); };
  process.on('SIGINT', close); process.on('SIGTERM', close); process.stdin.on('end', close);
}
