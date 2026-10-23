import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { openApplication } from './application.js';
import { openDatabase } from './db.js';
import { initializeRegistry, McpManager, readRegistry } from './integrations/mcp.js';
import { importCalendar, importNotion } from './integrations/imports.js';
import { transferDatabase } from './transfer.js';
import { parseMarkdown } from './vault.js';

const help = `OpenLoci v0.1
  npm run cli -- init                    Initialize vault and database
  npm run cli -- capture file.json       Create a record from JSON
  npm run cli -- import-markdown file.md Import a Markdown record
  npm run cli -- search [query]          Search local records
  npm run cli -- rebuild                 Reconcile Markdown and database
  npm run cli -- db:transfer [--apply]   Copy to TARGET_DATABASE_URL (preview by default)
  npm run cli -- mcp:init                Write private Notion/Google MCP configuration
  npm run cli -- mcp:status              Report configuration (no connections)
  npm run cli -- mcp:connect SERVER      Enable and connect; may open OAuth sign-in
  npm run cli -- mcp:tools SERVER        Discover tools on an enabled server
  npm run cli -- mcp:call SERVER TOOL arguments.json
  npm run cli -- import:notion options.json
  npm run cli -- import:calendar options.json
Imports preview unless options.json includes "apply": true.
Set environment variables in .env; keep credentials outside source control.`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') { console.log(help); return; }
  const settings = config();
  const loadJson = async (path?: string) => {
    if (!path) throw new Error('Expected a JSON file path');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  if (command === 'mcp:init') {
    await initializeRegistry(settings.mcpConfig, join(settings.vault, '.openloci'));
    console.log(`Created ${settings.mcpConfig}. Servers start disabled; use mcp:connect SERVER.`); return;
  }
  let servers = await readRegistry(settings.mcpConfig);
  if (command === 'mcp:connect') {
    const server = servers.find(server => server.id === args[0]);
    if (!server) throw new Error('Unknown server; run mcp:init first');
    server.enabled = true;
    await writeFile(settings.mcpConfig, JSON.stringify({ servers }, null, 2) + '\n', { mode: 0o600 });
    servers = await readRegistry(settings.mcpConfig);
  }
  const manager = new McpManager(servers);
  try {
    if (command === 'mcp:status') { console.log(JSON.stringify(await manager.status(), null, 2)); return; }
    if (command === 'mcp:connect' || command === 'mcp:tools') { console.log(JSON.stringify(await manager.tools(args[0]), null, 2)); return; }
    if (command === 'mcp:call') { console.log(JSON.stringify(await manager.call(args[0], args[1], await loadJson(args[2])), null, 2)); return; }
    const app = await openApplication(settings);
    try {
      let result: unknown;
      if (command === 'init') result = { vault: settings.vault, database: app.db.driver.kind, records: await app.db.count() };
      else if (command === 'capture') result = await app.create(await loadJson(args[0]));
      else if (command === 'import-markdown') result = await app.create(parseMarkdown(await readFile(args[0], 'utf8')));
      else if (command === 'search') result = await app.search({ q: args.join(' ') });
      else if (command === 'rebuild') {
        result = await app.rebuild();
        if ((result as { errors: unknown[] }).errors.length) process.exitCode = 1;
      } else if (command === 'import:notion') result = await importNotion(app, manager, await loadJson(args[0]));
      else if (command === 'import:calendar') result = await importCalendar(app, manager, await loadJson(args[0]));
      else if (command === 'db:transfer') {
        if (!process.env.TARGET_DATABASE_URL) throw new Error('Set TARGET_DATABASE_URL to the destination PostgreSQL URL');
        if (settings.databaseUrl === process.env.TARGET_DATABASE_URL) throw new Error('Source and target must differ');
        const target = await openDatabase(settings.vault, process.env.TARGET_DATABASE_URL);
        try { result = await transferDatabase(app.db, target, args.includes('--apply')); } finally { await target.close(); }
      } else throw new Error(`Unknown command ${command}\n${help}`);
      console.log(JSON.stringify(result, null, 2));
    } finally { await app.close(); }
  } finally { await manager.close(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Operation failed'); process.exitCode = 1; });
