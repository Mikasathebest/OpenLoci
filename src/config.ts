import 'dotenv/config';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

export function config() {
  const vault = resolve(process.env.OPENLOCI_VAULT || join(homedir(), '.local', 'share', 'openloci', 'vault'));
  const port = Number(process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  return {
    vault, port, databaseUrl: process.env.DATABASE_URL,
    timezone: process.env.OPENLOCI_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
    mcpConfig: resolve(process.env.OPENLOCI_MCP_CONFIG || join(vault, '.openloci', 'mcp.json')),
  };
}
