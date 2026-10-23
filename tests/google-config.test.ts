import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureGoogleMcp, googleMcpCallback, googleMcpUrl } from '../src/integrations/google.js';
import { initializeRegistry, readRegistry } from '../src/integrations/mcp.js';

test('official Google setup keeps credentials out of commands and preserves existing Notion config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openloci-official-google-'));
  const registry = join(root, 'mcp.json');
  await initializeRegistry(registry, root);
  const credentials = join(root, 'downloaded-client.json');
  await writeFile(credentials, JSON.stringify({ web: { client_id: 'test-client', client_secret: 'fixture-only-secret', redirect_uris: [googleMcpCallback] } }));
  const result = await configureGoogleMcp(registry, root, credentials);
  assert.equal(result.authenticated, false);
  const servers = await readRegistry(registry);
  assert.equal(servers.filter(server => server.id === 'notion').length, 1);
  const google = servers.find(server => server.id === 'google-calendar-official')!;
  assert.equal(google.enabled, false);
  assert.ok(google.args.includes(googleMcpUrl));
  assert.doesNotMatch(JSON.stringify(google), /fixture-only-secret/);
  assert.doesNotMatch(JSON.stringify(google.allowedTools), /create|delete|update/);
  const clientPath = google.args[google.args.indexOf('--static-oauth-client-info') + 1].slice(1);
  assert.equal(JSON.parse(await readFile(clientPath, 'utf8')).client_secret, 'fixture-only-secret');
  assert.equal((await stat(clientPath)).mode & 0o777, 0o600);
  await configureGoogleMcp(registry, root, credentials);
  assert.equal((await readRegistry(registry)).filter(server => server.id === 'google-calendar-official').length, 1);
});

test('official Google setup rejects desktop credentials and wrong callback before writing config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openloci-google-invalid-'));
  const credentials = join(root, 'downloaded-client.json');
  const registry = join(root, 'mcp.json');
  await writeFile(credentials, JSON.stringify({ installed: { client_id: 'test' } }));
  await assert.rejects(configureGoogleMcp(registry, root, credentials));
  await writeFile(credentials, JSON.stringify({ web: { client_id: 'test', client_secret: 'fixture', redirect_uris: ['https://example.invalid'] } }));
  await assert.rejects(configureGoogleMcp(registry, root, credentials), /authorized redirect/);
  assert.deepEqual(await readRegistry(registry), []);
});
