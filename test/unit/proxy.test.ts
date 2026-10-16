import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  type IncomingHttpHeaders,
  type RequestListener,
  request,
  type Server
} from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { type TestContext, test } from 'node:test';
import { startProxy } from '../../src/proxy.js';

async function listen(t: TestContext, handler?: RequestListener) {
  const server = createServer(handler);
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function fixture(t: TestContext, handler?: RequestListener) {
  const upstream = await listen(t, handler);
  const proxy = await startProxy(upstream.url);
  t.after(() => proxy.close());
  return { ...upstream, proxy };
}

async function get(
  url: string,
  headers: Record<string, string> = {},
  path?: string
): Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, ...(path ? { path } : {}) }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks)
        })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

test('preserves exact HTML bytes and security/cookie headers, adding only no-transform', async (t) => {
  const body = Buffer.concat([Buffer.from('<!doctype html>\n<html>'), Buffer.from([0, 128, 255])]);
  const { proxy } = await fixture(t, (_request, response) => {
    response.setHeader('cache-control', ['private', 'max-age=17']);
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'content-security-policy': "default-src 'self'; script-src 'nonce-test'",
      etag: '"integrity-hash"',
      'set-cookie': ['session=one; HttpOnly; Secure', 'other=two; SameSite=Strict']
    });
    response.end(body);
  });
  const result = await get(proxy.url);
  assert.deepEqual(result.body, body);
  assert.equal(
    createHash('sha256').update(result.body).digest('hex'),
    createHash('sha256').update(body).digest('hex')
  );
  assert.equal(result.headers['cache-control'], 'private, max-age=17, no-transform');
  assert.equal(
    result.headers['content-security-policy'],
    "default-src 'self'; script-src 'nonce-test'"
  );
  assert.equal(result.headers.etag, '"integrity-hash"');
  assert.deepEqual(result.headers['set-cookie'], [
    'session=one; HttpOnly; Secure',
    'other=two; SameSite=Strict'
  ]);
});

test('preserves existing cache directives without duplicate case-insensitive no-transform', async (t) => {
  for (const cache of [undefined, '', 'private, No-Transform, max-age=0', 'no-transform']) {
    const { proxy } = await fixture(t, (_request, response) => {
      response.setHeader('content-type', 'APPLICATION/XHTML+XML; charset=utf-8');
      if (cache !== undefined) response.setHeader('cache-control', cache);
      response.end('<html/>');
    });
    const result = await get(proxy.url);
    assert.equal(result.headers['cache-control'], cache || 'no-transform');
  }
});

test('leaves non-HTML cache headers and encoded bodies untouched', async (t) => {
  const body = Buffer.from([31, 139, 8, 0, 0, 0, 255]);
  const { proxy } = await fixture(t, (req, response) => {
    response.setHeader('content-type', 'application/octet-stream');
    response.setHeader('content-encoding', 'gzip');
    if (req.url === '/cached') response.setHeader('cache-control', 'public, max-age=3600');
    response.end(body);
  });
  for (const path of ['/', '/cached']) {
    const result = await get(proxy.url + path);
    assert.deepEqual(result.body, body);
    assert.equal(result.headers['content-encoding'], 'gzip');
    assert.equal(
      result.headers['cache-control'],
      path === '/' ? undefined : 'public, max-age=3600'
    );
  }
});

test('passes native authentication, session cookies, Host and Origin without injecting credentials', async (t) => {
  const seen: IncomingHttpHeaders[] = [];
  const { proxy } = await fixture(t, (req, response) => {
    seen.push(req.headers);
    if (!req.headers.authorization && !req.headers.cookie) {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="OpenCode"' }).end('unauthorized');
      return;
    }
    response.end('authenticated');
  });
  const denied = await get(proxy.url);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers['www-authenticate'], 'Basic realm="OpenCode"');
  assert.equal(denied.body.toString(), 'unauthorized');
  assert.equal(seen[0]?.authorization, undefined);
  const headers = {
    host: 'daemon.example.test',
    origin: 'https://ui.example.test',
    authorization: 'Bearer test-session',
    cookie: 'opencode-session=test-only; another=value'
  };
  assert.equal((await get(proxy.url, headers)).status, 200);
  for (const [name, value] of Object.entries(headers)) assert.equal(seen[1]?.[name], value);
  assert.equal(seen[1]?.['x-forwarded-for'], undefined);
  assert.equal((await get(proxy.url, { cookie: headers.cookie })).status, 200);
  assert.equal(seen[2]?.authorization, undefined);
});

test('does not rewrite redirects or allow absolute-form requests to replace the fixed target', async (t) => {
  let foreignRequests = 0;
  const foreign = await listen(t, (_req, res) => {
    foreignRequests++;
    res.end('wrong upstream');
  });
  let requests = 0;
  const { proxy } = await fixture(t, (_req, res) => {
    requests++;
    res.writeHead(302, { location: 'https://original.example.test/login' }).end();
  });
  const result = await get(proxy.url, {}, `${foreign.url}/secret`);
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, 'https://original.example.test/login');
  assert.equal(requests, 1);
  assert.equal(foreignRequests, 0);
});

test('streams SSE immediately and closes upstream when the downstream disconnects', {
  timeout: 3000
}, async (t) => {
  let upstreamClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    upstreamClosed = resolve;
  });
  const { proxy } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
    res.once('close', upstreamClosed);
  });
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(proxy.url, resolve);
    req.on('error', reject);
    req.end();
  });
  const [chunk] = await once(response, 'data');
  assert.equal(chunk.toString(), 'data: first\n\n');
  assert.equal(response.complete, false);
  assert.equal(response.headers['cache-control'], undefined);
  response.destroy();
  await closed;
});

async function websocket(server: Server, url: string) {
  const upstreamSocket = new Promise<Duplex>((resolve) => {
    server.once('upgrade', (req, socket) => {
      const accept = createHash('sha1')
        .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      socket.on('error', () => socket.destroy());
      socket.on('end', () => socket.destroy());
      // The test client sends a masked "hi" frame; reply with the unmasked echo.
      socket.once('data', () => socket.write(Buffer.from([0x81, 2, 104, 105])));
      resolve(socket);
    });
  });
  const client = new WebSocket(url.replace('http:', 'ws:'));
  await once(client, 'open');
  return { client, upstream: await upstreamSocket };
}

test('forwards actual WebSocket upgrades and echo traffic', { timeout: 3000 }, async (t) => {
  const { server, proxy } = await fixture(t);
  const { client } = await websocket(server, proxy.url);
  const message = once(client, 'message');
  client.send('hi');
  const [event] = await message;
  assert.equal(event.data, 'hi');
  const closed = once(client, 'close');
  await proxy.close();
  await closed;
});

test('idempotent shutdown kills active SSE and WebSockets on both sides and closes the listener', {
  timeout: 3000
}, async (t) => {
  let upstreamSseClosed!: () => void;
  const sseClosed = new Promise<void>((resolve) => {
    upstreamSseClosed = resolve;
  });
  const { server, proxy } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: active\n\n');
    res.once('close', upstreamSseClosed);
  });
  const { client, upstream } = await websocket(server, proxy.url);
  const wsClosed = once(client, 'close');
  const upstreamWsClosed = once(upstream, 'close');
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(proxy.url, resolve);
    req.on('error', reject);
    req.end();
  });
  response.on('error', () => {});
  await once(response, 'data');
  const downstreamClosed = new Promise<void>((resolve) => response.once('close', resolve));
  const closing = proxy.close();
  assert.equal(proxy.close(), closing);
  await Promise.all([closing, sseClosed, wsClosed, upstreamWsClosed, downstreamClosed]);
  await assert.rejects(get(proxy.url), { code: 'ECONNREFUSED' });
});

test('returns only a generic 502 when an upstream connection fails or resets', async (t) => {
  const { proxy } = await fixture(t, (req) => req.socket.destroy());
  const result = await get(proxy.url);
  assert.equal(result.status, 502);
  assert.equal(result.body.toString(), 'Bad Gateway');
});

test('rejects malformed, non-loopback, non-root and credential-bearing targets', async () => {
  for (const target of [
    'not a URL',
    'file:///etc/passwd',
    'http://localhost:1234',
    'http://example.test',
    'http://192.168.1.1',
    'http://[::]',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://127.0.0.999',
    'http://user:secret@127.0.0.1',
    'http://@127.0.0.1',
    'http://127.0.0.1/path',
    'http://127.0.0.1/..',
    'http://127.0.0.1?',
    'http://127.0.0.1#',
    'http://127.0.0.1\\@example.test'
  ]) {
    await assert.rejects(startProxy(target), { message: 'Invalid loopback proxy target' });
  }
});

test('accepts literal IPv6 loopback and HTTPS targets', async (t) => {
  for (const target of ['http://[::1]:1', 'https://127.0.0.1:1']) {
    const proxy = await startProxy(target);
    t.after(() => proxy.close());
    assert.equal((await get(proxy.url)).status, 502);
  }
});

test('shutdown closes pending Expect requests and their upstream sockets', {
  timeout: 3000
}, async (t) => {
  const { proxy, server } = await fixture(t, () => {});
  const received = once(server, 'request');
  const req = request(proxy.url, {
    method: 'POST',
    headers: { expect: '100-continue', 'content-length': '0' }
  });
  req.on('error', () => {});
  req.end();
  const [incoming] = await received;
  const closed = new Promise<void>((resolve) => incoming.socket.once('close', resolve));
  await proxy.close();
  await closed;
});

test('upstream reset during a streaming response does not leave an unhandled error', {
  timeout: 3000
}, async (t) => {
  const { proxy } = await fixture(t, (_req, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: first\n\n');
    setImmediate(() => response.destroy());
  });
  await assert.rejects(get(proxy.url));
});
