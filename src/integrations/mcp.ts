import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppError } from '../core.js';

const serverSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/), enabled: z.boolean().default(false),
  transport: z.enum(['stdio', 'http']), command: z.string().optional(), args: z.array(z.string()).default([]),
  url: z.string().url().optional(), bearerTokenEnv: z.string().optional(),
  env: z.record(z.string()).default({}), inheritEnv: z.array(z.string()).default([]),
  requiredEnv: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]), timeoutMs: z.number().int().min(1000).max(300_000).default(30_000),
}).superRefine((server, ctx) => {
  if (server.transport === 'stdio' && !server.command) ctx.addIssue({ code: 'custom', message: 'stdio requires command' });
  if (server.transport === 'http' && !server.url) ctx.addIssue({ code: 'custom', message: 'http requires url' });
  if (server.url) {
    const url = new URL(server.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      ctx.addIssue({ code: 'custom', message: 'Remote MCP servers require HTTPS' });
    }
  }
});
export type McpConnection = z.infer<typeof serverSchema>;
const registrySchema = z.object({ servers: z.array(serverSchema) }).refine(registry => new Set(registry.servers.map(s => s.id)).size === registry.servers.length, 'Duplicate server IDs');

export async function readRegistry(path: string) {
  try { return registrySchema.parse(JSON.parse(await readFile(path, 'utf8'))).servers; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function initializeRegistry(path: string, stateDirectory: string) {
  const require = createRequire(import.meta.url);
  const proxy = resolve(dirname(require.resolve('mcp-remote/package.json')), 'dist/proxy.js');
  const registry = { servers: [
    { id: 'notion', enabled: false, transport: 'stdio', command: process.execPath,
      args: [proxy, 'https://mcp.notion.com/mcp'],
      env: { MCP_REMOTE_CONFIG_DIR: resolve(stateDirectory, 'notion-auth') },
      allowedTools: ['notion-search', 'notion-fetch'], timeoutMs: 180_000 },
    { id: 'google-calendar', enabled: false, transport: 'stdio', command: 'npx',
      args: ['--yes', '@cocal/google-calendar-mcp@2.7.0'],
      env: { GOOGLE_CALENDAR_MCP_TOKEN_PATH: resolve(stateDirectory, 'google-tokens.json') },
      inheritEnv: ['GOOGLE_OAUTH_CREDENTIALS'], requiredEnv: ['GOOGLE_OAUTH_CREDENTIALS'],
      allowedTools: ['list-calendars', 'list-events', 'get-event'], timeoutMs: 180_000 },
  ] };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(registry, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return registry;
}

export class McpManager {
  private clients = new Map<string, Client>();
  private opening = new Map<string, Promise<Client>>();
  constructor(public servers: McpConnection[]) {}
  server(id: string) {
    const server = this.servers.find(s => s.id === id);
    if (!server) throw new AppError(404, `MCP server ${id} is not configured; run mcp:init`);
    if (!server.enabled) throw new AppError(409, `MCP server ${id} is disabled; enable it in your private MCP config`);
    return server;
  }
  async connect(id: string): Promise<Client> {
    this.server(id);
    const cached = this.clients.get(id);
    if (cached) return cached;
    const pending = this.opening.get(id);
    if (pending) return pending;
    const task = this.open(id).finally(() => this.opening.delete(id));
    this.opening.set(id, task);
    return task;
  }
  private async open(id: string) {
    const server = this.server(id);
    const environment: Record<string, string> = {};
    // Never hand unrelated DATABASE_URL/model/API secrets to external subprocesses.
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'SystemRoot', ...server.inheritEnv]) {
      if (process.env[key]) environment[key] = process.env[key]!;
    }
    Object.assign(environment, server.env);
    for (const key of server.requiredEnv) {
      if (!environment[key]) throw new AppError(409, `Set ${key} before connecting ${id}`);
    }
    if (environment.GOOGLE_OAUTH_CREDENTIALS) await access(environment.GOOGLE_OAUTH_CREDENTIALS);
    const client = new Client({ name: 'openloci', version: '0.1.0' });
    let transport;
    if (server.transport === 'stdio') {
      transport = new StdioClientTransport({ command: server.command!, args: server.args, env: environment, stderr: 'inherit' });
    } else {
      const token = server.bearerTokenEnv ? process.env[server.bearerTokenEnv] : undefined;
      if (server.bearerTokenEnv && !token) throw new AppError(409, `Set ${server.bearerTokenEnv}`);
      transport = new StreamableHTTPClientTransport(new URL(server.url!), { requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined });
    }
    try {
      await client.connect(transport, { timeout: server.timeoutMs });
      client.onclose = () => { this.clients.delete(id); };
      this.clients.set(id, client);
      return client;
    } catch (error) { await transport.close().catch(() => undefined); throw error; }
  }
  async tools(id: string) {
    const client = await this.connect(id);
    const server = this.server(id);
    const tools = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools({ cursor }, { timeout: server.timeoutMs });
      tools.push(...result.tools.map(tool => ({ ...tool, allowed: server.allowedTools.includes(tool.name) })));
      cursor = result.nextCursor;
      if (tools.length > 1000) throw new AppError(502, 'MCP tool list exceeded limit');
    } while (cursor);
    return tools;
  }
  async call(id: string, name: string, args: Record<string, unknown>) {
    const server = this.server(id);
    if (!server.allowedTools.includes(name)) throw new AppError(403, `Tool ${name} is not allowed for ${id}`);
    const client = await this.connect(id);
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: server.timeoutMs });
    if (result.isError) throw new AppError(502, `MCP tool ${id}/${name} failed; check server authentication and arguments`);
    return result;
  }
  async status() {
    return this.servers.map(server => ({ id: server.id, enabled: server.enabled, connected: this.clients.has(server.id),
      missingEnv: server.requiredEnv.filter(key => !server.env[key] && !process.env[key]) }));
  }
  async close() {
    await Promise.allSettled([...this.opening.values()]);
    await Promise.allSettled([...this.clients.values()].map(client => client.close()));
    this.clients.clear();
  }
}
