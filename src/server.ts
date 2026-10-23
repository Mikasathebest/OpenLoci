import { config } from './config.js';
import { openApplication } from './application.js';
import { readRegistry, McpManager } from './integrations/mcp.js';
import { createHttpApp } from './http.js';
import { watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const settings = config();
const app = await openApplication(settings);
const mcp = new McpManager(await readRegistry(settings.mcpConfig));
await mkdir(join(settings.vault, 'records'), { recursive: true, mode: 0o700 });
let debounce: ReturnType<typeof setTimeout> | undefined;
const reconcile = () => { app.rebuild().catch(() => console.error('Vault reconciliation failed; run rebuild')); };
const watcher = watch(join(settings.vault, 'records'), { recursive: true }, (_event, name) => {
  if (!name?.endsWith('.md')) return;
  clearTimeout(debounce); debounce = setTimeout(reconcile, 500);
});
watcher.on('error', () => console.error('File watcher unavailable; periodic reconciliation remains active'));
const reconciliation = setInterval(reconcile, 60_000);
reconciliation.unref();
const server = createHttpApp(app, mcp).listen(settings.port, '127.0.0.1', () => {
  console.log(`OpenLoci v0.1: http://127.0.0.1:${settings.port} (${app.db.driver.kind})`);
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  watcher.close(); clearTimeout(debounce); clearInterval(reconciliation);
  server.close(async () => { await mcp.close(); await app.close(); });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
server.on('error', async error => { console.error(error.message); await mcp.close(); await app.close(); process.exitCode = 1; });
