import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import type { Info } from '@opencode/client/service';
import { connectDaemon, DaemonError } from '../../src/daemon.js';

const password = 'test-only-password';

async function fixture(
  t: TestContext,
  options: {
    pid?: number;
    password?: string;
    authenticated?: boolean;
    hang?: boolean;
    failVerification?: boolean;
  } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), 'zero-trust-daemon-'));
  const file = join(directory, 'service.json');
  const requests: { url: string | undefined; authorization: string | undefined }[] = [];
  const secret = options.password ?? password;
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    if (options.hang) return;
    if (options.failVerification && requests.length > 1) {
      response.writeHead(500).end(`private payload ${secret}`);
      return;
    }
    if (
      options.authenticated !== false &&
      request.headers.authorization !==
        `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`
    ) {
      response.writeHead(401).end('unauthorized');
      return;
    }
    if (request.url !== '/api/info') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        version: '2.0.29',
        pid: options.pid ?? process.pid,
        urls: [],
        paths: { tmp: directory }
      })
    );
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const registration: Info = {
    id: 'test-service',
    version: '2.0.29',
    url,
    pid: options.pid ?? process.pid,
    ...(options.authenticated === false ? {} : { password: secret })
  };
  await writeFile(file, JSON.stringify(registration));
  return { file, url, registration, requests };
}

test('connects to the authenticated hosting process without changing its registration', async (t) => {
  const { file, url, requests } = await fixture(t);
  const before = await readFile(file, 'utf8');
  const daemon = await connectDaemon({ serviceFile: file });
  assert.equal(daemon.url, url);
  assert.equal((await daemon.client.server.info()).pid, process.pid);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.url === '/api/info'));
  assert.ok(
    requests.every(
      (request) =>
        request.authorization === `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    )
  );
  assert.equal(await readFile(file, 'utf8'), before);
  assert.ok(!JSON.stringify(daemon).includes(password));
});

test('rejects another healthy daemon process', async (t) => {
  const { file, registration } = await fixture(t, { pid: process.pid + 1 });
  // The registration claims this process, but the server answering its port is another one.
  await writeFile(file, JSON.stringify({ ...registration, pid: process.pid } satisfies Info));
  await assert.rejects(connectDaemon({ serviceFile: file }), { name: 'DaemonError' });
});

test('never sends credentials to another process registration', async (t) => {
  const { file, registration, requests } = await fixture(t, { pid: process.pid + 1 });
  await assert.rejects(connectDaemon({ serviceFile: file }), { code: 'daemon-mismatch' });
  const { pid: _pid, ...withoutPid } = registration;
  await writeFile(file, JSON.stringify(withoutPid));
  await assert.rejects(connectDaemon({ serviceFile: file }), { code: 'daemon-mismatch' });
  assert.equal(requests.length, 0);
});

test('requires native basic authentication with a nonempty password', async (t) => {
  const { file, requests } = await fixture(t, { authenticated: false });
  await assert.rejects(connectDaemon({ serviceFile: file }), {
    code: 'daemon-auth-required'
  });
  assert.equal(requests.length, 1);
  const empty = await fixture(t, { password: '' });
  await assert.rejects(connectDaemon({ serviceFile: empty.file }), {
    code: 'daemon-auth-required'
  });
});

test('rejects remote, wildcard, credential-bearing, and non-base URLs before probing', async (t) => {
  const { file, url, registration, requests } = await fixture(t);
  for (const target of [
    'https://example.com',
    'http://192.0.2.1:4096',
    'http://0.0.0.0:4096',
    'http://[::]:4096',
    'ftp://127.0.0.1',
    url.replace('://', `://opencode:${password}@`),
    `${url}/other`,
    `${url}/other/..`,
    `${url}?secret=${password}`,
    `${url}#${password}`,
    'not a URL'
  ]) {
    await writeFile(file, JSON.stringify({ ...registration, url: target } satisfies Info));
    await assert.rejects(connectDaemon({ serviceFile: file }), (error: unknown) => {
      assert.ok(error instanceof DaemonError);
      assert.equal(error.code, 'daemon-not-loopback');
      assert.ok(!String(error).includes(password));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  assert.equal(requests.length, 0);
});

test('normalizes localhost to a literal loopback target', async (t) => {
  const { file, url, registration } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      ...registration,
      url: `${url.replace('127.0.0.1', 'localhost')}/`
    } satisfies Info)
  );
  assert.equal((await connectDaemon({ serviceFile: file })).url, url);
});

test('missing registration fails without creating or starting a service', async (t) => {
  const { file, requests } = await fixture(t);
  await rm(file);
  await assert.rejects(connectDaemon({ serviceFile: file }), {
    code: 'daemon-unavailable'
  });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.equal(requests.length, 0);
});

test('malformed registration errors do not expose registration secrets', async (t) => {
  const { file, requests } = await fixture(t);
  await writeFile(file, `{"password":"${password}",bad-json`);
  await assert.rejects(connectDaemon({ serviceFile: file }), (error: unknown) => {
    assert.ok(error instanceof DaemonError);
    assert.equal(error.code, 'daemon-unavailable');
    assert.ok(!String(error).includes(password));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(requests.length, 0);
});

test('verification failures never include response payloads or credentials', async (t) => {
  const { file } = await fixture(t, { failVerification: true });
  await assert.rejects(connectDaemon({ serviceFile: file }), (error: unknown) => {
    assert.ok(error instanceof DaemonError);
    assert.equal(error.code, 'daemon-unavailable');
    assert.ok(!String(error).includes(password));
    assert.ok(!String(error).includes('private payload'));
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('discovery of an unresponsive service has a bounded timeout', {
  timeout: 10_000
}, async (t) => {
  const { file } = await fixture(t, { hang: true });
  await assert.rejects(connectDaemon({ serviceFile: file }), {
    code: 'daemon-unavailable'
  });
});
