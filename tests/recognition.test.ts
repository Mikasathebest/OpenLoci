import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recognizeWith } from '../src/integrations/recognition.js';

test('user-configured base URLs, models and token files work for text JSON recognition', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'openloci-recognition-'));
  const tokenFile = join(directory, 'token');
  await writeFile(tokenFile, 'test-configured-token\n', { mode: 0o600 });
  const seen: { url?: string; token?: string; body?: any }[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ url: req.url, token: req.headers.authorization, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '{"date":null,"city":""}' } }] }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const url of ['/v1', '/v1/', '/v1/chat/completions/', '/v1/chat/completions?mode=test']) {
    const result = await recognizeWith({ baseUrl: root + url, model: 'user-selected-model', apiKeyFile: tokenFile }, 'Extract this reservation');
    assert.deepEqual(result, { date: null, city: '' });
  }
  for (const request of seen) {
    assert.equal(request.token, 'Bearer test-configured-token');
    assert.equal(request.body.model, 'user-selected-model');
    assert.equal(request.body.messages[0].role, 'system');
    assert.deepEqual(request.body.messages[1], { role: 'user', content: 'Extract this reservation' });
    assert.equal('system' in request.body, false);
  }
  assert.deepEqual(seen.map(request => request.url), ['/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions?mode=test']);
});

test('recognition reports provider errors and malformed output without exposing tokens', async t => {
  const server = createServer(async (req, res) => {
    req.resume();
    if (req.url?.startsWith('/failure/')) { res.statusCode = 401; res.end('secret provider details'); }
    else if (req.url?.startsWith('/invalid/')) res.end('{not json');
    else res.end(JSON.stringify({ choices: [{ message: { content: 'not a JSON object' } }] }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const path of ['/failure', '/invalid', '/content']) {
    await assert.rejects(recognizeWith({ baseUrl: root + path, model: 'user-model', apiKey: 'test-token' }, 'Extract'), (error: any) => {
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /test-token|secret provider details/);
      return true;
    });
  }
  for (const baseUrl of ['http://remote.example/v1', 'ftp://localhost/v1', 'https://user:secret@example.com/v1']) {
    await assert.rejects(recognizeWith({ baseUrl, model: 'user-model', apiKey: 'test-token' }, 'Extract'), (error: any) => error.status === 400);
  }
});
