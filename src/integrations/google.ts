import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { readRegistry } from './mcp.js';

export const googleMcpUrl = 'https://calendarmcp.googleapis.com/mcp/v1';
export const googleMcpCallback = 'http://localhost:4311/oauth/callback';

export async function configureGoogleMcp(registryPath: string, stateDirectory: string, credentialPath: string) {
  const credentials = z.object({ web: z.object({
    client_id: z.string().min(1), client_secret: z.string().min(1), redirect_uris: z.array(z.string().url()),
  }).passthrough() }).parse(JSON.parse(await readFile(credentialPath, 'utf8'))).web;
  if (!credentials.redirect_uris.includes(googleMcpCallback)) throw new Error(`Add ${googleMcpCallback} as an authorized redirect URI for the Google Web application OAuth client, then download its JSON again.`);
  const directory = resolve(stateDirectory, 'google-official');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const clientPath = join(directory, 'client.json');
  const metadataPath = join(directory, 'metadata.json');
  await writeFile(clientPath, JSON.stringify({ client_id: credentials.client_id, client_secret: credentials.client_secret }), { mode: 0o600 });
  await writeFile(metadataPath, JSON.stringify({
    client_name: 'OpenLoci', redirect_uris: [googleMcpCallback], token_endpoint_auth_method: 'client_secret_post',
    scope: ['calendar.calendarlist.readonly', 'calendar.events.freebusy', 'calendar.events.readonly'].map(scope => `https://www.googleapis.com/auth/${scope}`).join(' '),
  }), { mode: 0o600 });
  const require = createRequire(import.meta.url);
  const proxy = resolve(dirname(require.resolve('mcp-remote/package.json')), 'dist/proxy.js');
  const server = {
    id: 'google-calendar-official', enabled: false, transport: 'stdio', command: process.execPath,
    args: [proxy, googleMcpUrl, '4311', '--host', 'localhost', '--static-oauth-client-info', `@${clientPath}`,
      '--static-oauth-client-metadata', `@${metadataPath}`, '--authorize-param', 'access_type=offline', '--authorize-param', 'prompt=consent'],
    env: { MCP_REMOTE_CONFIG_DIR: join(directory, 'auth') },
    allowedTools: ['list_calendars', 'list_events', 'get_event', 'calendar.list_calendars', 'calendar.list_events', 'calendar.get_event'],
    timeoutMs: 180_000,
  };
  const servers = await readRegistry(registryPath);
  const existing = servers.findIndex(entry => entry.id === server.id);
  if (existing >= 0) servers.splice(existing, 1);
  await mkdir(dirname(registryPath), { recursive: true, mode: 0o700 });
  await writeFile(registryPath, JSON.stringify({ servers: [...servers, server] }, null, 2) + '\n', { mode: 0o600 });
  return { server: server.id, url: googleMcpUrl, callback: googleMcpCallback, configured: true, authenticated: false };
}
