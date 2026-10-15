import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { mock } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const directory = process.env.OPENCODE_TEST_ROOT;
assert.ok(directory);
const connectorFile = fileURLToPath(new URL('./fake-cloudflared.mjs', import.meta.url));
const forks = [];
const messages = [];
const processModule = await import('node:child_process');
const launch = processModule.fork;
const { default: defaultExport, ...namedExports } = processModule;

// Replace only the external executable at the launch boundary, not the manager, IPC helper, or daemon APIs.
function fork(...args) {
  const child = launch(...args);
  if (String(args[0]).endsWith('/helper.js')) {
    forks.push(child);
    const send = child.send.bind(child);
    child.send = (message, ...rest) => {
      if (message.type === 'start') {
        messages.push(message);
        return send(
          { ...message, executable: process.execPath, prefixArgs: [connectorFile, directory] },
          ...rest
        );
      }
      return send(message, ...rest);
    };
  }
  return child;
}
mock.module('node:child_process', {
  exports: { ...namedExports, fork, default: { ...defaultExport, fork } }
});

const { OpenCode } = await import('@opencode/sdk');
const { ZeroTrust } = await import('opencode-zero-trust/rpc');
const config = path.join(directory, 'config');
await mkdir(config);
await writeFile(path.join(directory, 'behavior.json'), '{}');
await writeFile(path.join(directory, 'ready'), 'ready');
const credentialsFile = path.join(directory, 'credentials.json');
const id = '6ebbf456-fce2-47a4-845f-06bc17f7f130';
await writeFile(
  credentialsFile,
  JSON.stringify({ AccountTag: 'account', TunnelID: id, TunnelSecret: 'fake-secret' }),
  { mode: 0o600 }
);
const password = 'fixture-native-password';
const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
let host;
const server = createServer((request, response) => {
  if (request.headers.authorization !== auth) return response.writeHead(401).end();
  if (!host) return response.writeHead(503).end();
  const action =
    request.url === '/api/info'
      ? host.server.info()
      : request.url === '/api/pair' && request.method === 'POST'
        ? host.server.pair()
        : undefined;
  if (!action) return response.writeHead(404).end();
  void action
    .then((value) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(value));
    })
    .catch(() => response.writeHead(500).end());
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const serviceFile = path.join(directory, 'service.json');
await writeFile(
  serviceFile,
  JSON.stringify({ url: origin, pid: process.pid, password, version: '2.0.29', id: 'fixture' })
);
const options = {
  hostname: 'opencode.example.com',
  credentialsFile,
  serviceFile,
  nodePath: process.execPath,
  access: { teamName: 'example-team', audience: 'a'.repeat(64) }
};

async function until(read, accepts) {
  const deadline = Date.now() + 15_000;
  let last;
  while (Date.now() < deadline) {
    const value = await read().catch((error) => {
      if (error.type === 'rpc.unavailable') return undefined;
      throw error;
    });
    if (value !== undefined && accepts(value)) return value;
    last = value;
    await sleep(25);
  }
  throw new Error(`Configured host did not reach the expected state: ${JSON.stringify(last)}`);
}

try {
  host = await OpenCode.create({
    app: { version: '2.0.29' },
    database: { path: ':memory:' },
    config: {
      directory: config,
      project: false,
      content: JSON.stringify({
        plugins: [{ package: fileURLToPath(new URL('../../', import.meta.url)), options }]
      })
    },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false }
  });
  const location = { directory: path.join(directory, 'first') };
  await mkdir(location.directory);
  await host.sessions.create({ location });
  const rpc = host.rpc(ZeroTrust);
  const ready = await until(
    () => rpc.status({}, { location }),
    (status) => status.state === 'ready'
  );
  assert.equal(forks.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(ready.helperPid, forks[0].pid);
  const [message] = messages;
  assert.equal(message.config.tunnel, id);
  assert.equal(message.config.ingress[0].service, origin);
  assert.deepEqual(message.config.ingress[0].originRequest.access, {
    required: true,
    teamName: options.access.teamName,
    audTag: [options.access.audience]
  });
  assert.deepEqual(message.config.ingress[1], { service: 'http_status:404' });
  assert.ok(!JSON.stringify(message).includes(password));
  assert.ok(!JSON.stringify(message).includes('fake-secret'));

  const second = { directory: path.join(directory, 'second') };
  await mkdir(second.directory);
  await host.sessions.create({ location: second });
  assert.equal((await rpc.status({}, { location: second })).connectorPid, ready.connectorPid);
  await host.location.reload();
  const reloaded = await until(
    () => rpc.status({}, { location: second }),
    (status) => status.state === 'ready'
  );
  assert.equal(reloaded.connectorPid, ready.connectorPid);
  assert.equal(forks.length, 1);

  const pairing = await rpc.pair({}, { location: second });
  assert.equal(new URL(pairing.url).origin, 'https://opencode.example.com');
  assert.match(new URL(pairing.url).pathname, /^\/auth\/connect\/[A-Za-z0-9_-]+$/);
  assert.equal(pairing.expiresIn, 300);
  assert.ok(!pairing.url.includes(password));
  forks[0].kill('SIGKILL');
  const failed = await until(
    () => rpc.status({}, { location: second }),
    (status) => status.state === 'error'
  );
  assert.equal(failed.error, 'helper-unavailable');
  await assert.rejects(rpc.pair({}, { location: second }), (error) => error.type === 'not_ready');
  assert.equal(forks.length, 1);
  console.log('Configured OpenCode integration passed');
} finally {
  for (const child of forks) {
    if (child.connected) child.send({ type: 'stop' });
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  }
  // Force-killing the helper above deliberately exercises the documented orphan case. Reap the test's connector.
  const recorded = await readFile(path.join(directory, 'runs.jsonl'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (recorded) {
    const runs = recorded
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    for (const run of runs) {
      try {
        process.kill(run.pid, 'SIGKILL');
      } catch {
        /* It may already have exited. */
      }
      await until(
        async () => {
          try {
            process.kill(run.pid, 0);
            return false;
          } catch {
            return true;
          }
        },
        (dead) => dead
      );
    }
  }
  await host?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
}
