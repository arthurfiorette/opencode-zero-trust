import assert from 'node:assert/strict';
import { type ChildProcess, fork } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  type HelperStatus,
  helperStatusSchema,
  type StartMessage,
  startMessageSchema
} from '../../src/helper-protocol.js';

const helperFile = fileURLToPath(new URL('../../dist/helper.js', import.meta.url));
const connectorFile = fileURLToPath(new URL('../fixtures/fake-cloudflared.mjs', import.meta.url));
const parentFile = fileURLToPath(new URL('../fixtures/helper-parent.mjs', import.meta.url));

interface Run {
  pid: number;
  at: number;
  cwd: string;
  args: string[];
  configFile: string;
  config: StartMessage['config'];
  configMode: number;
  directoryMode: number;
  env: NodeJS.ProcessEnv;
}

async function until<T>(read: () => Promise<T> | T, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await sleep(25);
  }
  throw new Error('Timed out waiting for helper lifecycle transition');
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function fixture(t: TestContext, behavior: Record<string, boolean> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'zero-trust-supervisor-test-'));
  await writeFile(join(directory, 'behavior.json'), JSON.stringify(behavior));
  await writeFile(join(directory, 'ready'), 'ready');
  const message: StartMessage = {
    type: 'start',
    executable: process.execPath,
    prefixArgs: [connectorFile, directory],
    config: {
      tunnel: '44a8ba75-2cd0-441a-97d5-9ea0de014346',
      'credentials-file': join(directory, 'credentials.json'),
      ingress: [
        {
          hostname: 'opencode.example.com',
          service: 'http://127.0.0.1:43210',
          originRequest: { access: { required: true, teamName: 'example', audTag: ['audience'] } }
        },
        { service: 'http_status:404' }
      ]
    }
  };
  const runs = async (): Promise<Run[]> => {
    try {
      const contents = await readFile(join(directory, 'runs.jsonl'), 'utf8');
      return contents
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line: string) => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };
  t.after(async () => {
    for (const run of await runs()) {
      if (alive(run.pid)) process.kill(run.pid, 'SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, message, runs };
}

function launch(t: TestContext, message: unknown, environment: NodeJS.ProcessEnv = process.env) {
  const child = fork(helperFile, [], {
    env: environment,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const statuses: HelperStatus[] = [];
  let output = '';
  child.stdout?.on('data', (data) => (output += data));
  child.stderr?.on('data', (data) => (output += data));
  child.on('message', (status) => statuses.push(helperStatusSchema.parse(status)));
  t.after(async () => {
    if (child.connected) child.disconnect();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited(child);
    clearTimeout(timer);
  });
  child.send(message as object);
  return { child, statuses, output: () => output };
}

test('protocol rejects unsafe config and permits only sanitized error codes', async (t) => {
  assert.equal(startMessageSchema.safeParse({ type: 'start' }).success, false);
  assert.equal(
    helperStatusSchema.safeParse({ state: 'error', error: 'secret text' }).success,
    false
  );
  const { message } = await fixture(t);
  assert.equal(startMessageSchema.safeParse(message).success, true);
  assert.equal(startMessageSchema.safeParse({ ...message, preventTransform: true }).success, true);
  assert.equal(
    startMessageSchema.safeParse({ ...message, preventTransform: 'true' }).success,
    false
  );
  const nativeOnly = structuredClone(message);
  delete nativeOnly.config.ingress[0].originRequest;
  assert.equal(startMessageSchema.safeParse(nativeOnly).success, true);
  assert.equal(
    startMessageSchema.safeParse({
      ...nativeOnly,
      config: {
        ...nativeOnly.config,
        ingress: [
          { ...nativeOnly.config.ingress[0], originRequest: {} },
          nativeOnly.config.ingress[1]
        ]
      }
    }).success,
    false
  );
  const tls = structuredClone(message);
  tls.config.ingress[0].service = 'https://127.0.0.1:443';
  assert.equal(startMessageSchema.safeParse(tls).success, true);
  for (const service of ['http://example.com', 'ftp://127.0.0.1', 'http://user:secret@127.0.0.1']) {
    const unsafe = structuredClone(message);
    unsafe.config.ingress[0].service = service;
    assert.equal(startMessageSchema.safeParse(unsafe).success, false);
  }
  assert.equal(
    startMessageSchema.safeParse({ ...message, env: { TUNNEL_TOKEN: 'secret' } }).success,
    false
  );
  assert.equal(
    startMessageSchema.safeParse({
      ...message,
      config: { ...message.config, 'credentials-file': 'relative' }
    }).success,
    false
  );
  assert.equal(
    startMessageSchema.safeParse({
      ...message,
      config: {
        ...message.config,
        ingress: [
          {
            ...message.config.ingress[0],
            originRequest: { access: { required: false, teamName: 'example', audTag: [] } }
          },
          { service: 'http_status:404' }
        ]
      }
    }).success,
    false
  );
});

for (const preventTransform of [false, true]) {
  test(`helper ${preventTransform ? 'owns and closes the header proxy' : 'keeps direct ingress by default'}`, async (t) => {
    const origin = createHttpServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'cache-control': 'no-cache',
        'content-security-policy': "default-src 'self'"
      });
      response.end('<!doctype html><p>unchanged bytes</p>');
    });
    await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
    const address = origin.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    t.after(async () => {
      origin.closeAllConnections();
      await new Promise<void>((resolve) => origin.close(() => resolve()));
    });
    const f = await fixture(t);
    f.message.config.ingress[0].service = url;
    if (preventTransform) f.message.preventTransform = true;
    const { child, statuses } = launch(t, f.message);
    await until(
      () => statuses,
      (values) => values.some((status) => status.state === 'ready')
    );
    const [run] = await f.runs();
    assert.ok(run);
    const target = run.config.ingress[0].service;
    assert.deepEqual(
      run.config.ingress[0].originRequest,
      f.message.config.ingress[0].originRequest
    );
    assert.deepEqual(run.config.ingress[1], { service: 'http_status:404' });
    if (preventTransform) assert.notEqual(target, url);
    else assert.equal(target, url);
    const response = await fetch(target);
    assert.equal(await response.text(), '<!doctype html><p>unchanged bytes</p>');
    assert.equal(
      response.headers.get('cache-control'),
      preventTransform ? 'no-cache, no-transform' : 'no-cache'
    );
    assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
    child.send({ type: 'stop' });
    await until(
      () => child.exitCode,
      (code) => code !== null
    );
    assert.equal(child.exitCode, 0);
    assert.equal(await exists(run.configFile), false);
    if (preventTransform) await assert.rejects(fetch(target));
  });
}

test('readiness follows /ready and network recovery without exposing child output or environment', async (t) => {
  const f = await fixture(t);
  const { child, statuses, output } = launch(t, f.message, {
    ...process.env,
    OPENAI_API_KEY: 'model-secret',
    OPENCODE_SERVER_PASSWORD: 'admin-secret',
    TUNNEL_TOKEN: 'tunnel-secret',
    TUNNEL_METRICS: '0.0.0.0:80'
  });
  await until(
    () => statuses,
    (values) => values.some((status) => status.state === 'ready')
  );
  const [run] = await f.runs();
  assert.ok(run);
  assert.deepEqual(run.config, f.message.config);
  assert.deepEqual(run.args, [
    'tunnel',
    '--config',
    run.configFile,
    '--no-autoupdate',
    '--metrics',
    '127.0.0.1:0',
    '--grace-period',
    '2s',
    '--loglevel',
    'info',
    'run',
    f.message.config.tunnel
  ]);
  assert.equal(run.cwd, homedir());
  if (process.platform !== 'win32') {
    assert.equal(run.configMode, 0o600);
    assert.equal(run.directoryMode, 0o700);
  }
  for (const key of [
    'OPENAI_API_KEY',
    'OPENCODE_SERVER_PASSWORD',
    'TUNNEL_TOKEN',
    'TUNNEL_METRICS'
  ]) {
    assert.equal(run.env[key], undefined);
  }
  for (const state of ['connecting', 'ready', 'offline', 'ready']) {
    const start = statuses.length;
    await writeFile(join(f.directory, 'ready'), state);
    const expected = state === 'offline' ? 'connecting' : state;
    await until(
      () => statuses.slice(start),
      (values) => values.some((status) => status.state === expected)
    );
  }
  assert.equal(output(), '');
  child.send({ type: 'stop' });
  await until(
    () => child.exitCode,
    (code) => code !== null
  );
  assert.equal(child.exitCode, 0);
  assert.equal(alive(run.pid), false);
  assert.equal(await exists(run.configFile), false);
});

test('readiness is trusted only from the port the connector announces', async (t) => {
  const f = await fixture(t, { silentMetrics: true });
  const { statuses } = launch(t, f.message);
  const [run] = await until(f.runs, (values) => values.length > 0);
  assert.ok(run);
  await sleep(1500);
  assert.ok(statuses.some((status) => status.state === 'connecting'));
  assert.ok(!statuses.some((status) => status.state === 'ready'));
});

test('crashes restart with increasing backoff and disconnect cancels restart', async (t) => {
  const f = await fixture(t, { crash: true });
  const { child, statuses } = launch(t, f.message);
  const runs = await until(f.runs, (values) => values.length >= 3);
  assert.ok(runs[0] && runs[1] && runs[2]);
  assert.ok(runs[1].at - runs[0].at >= 500);
  assert.ok(runs[2].at - runs[1].at >= 1000);
  await until(
    () => statuses,
    (values) => values.filter((status) => status.state === 'restarting').length >= 3
  );
  assert.ok(statuses.some((status) => status.error === 'cloudflared-exited'));
  child.disconnect();
  await until(
    () => child.exitCode,
    (code) => code !== null
  );
  const count = (await f.runs()).length;
  await sleep(600);
  assert.equal((await f.runs()).length, count);
  assert.equal(await exists(runs[0].configFile), false);
});

test('IPC disconnect forcibly terminates a connector that ignores SIGTERM and removes its private config', async (t) => {
  const f = await fixture(t, { ignoreTerm: true });
  const { child } = launch(t, f.message);
  const [run] = await until(f.runs, (values) => values.length > 0);
  assert.ok(run);
  const started = Date.now();
  child.disconnect();
  await until(
    () => child.exitCode,
    (code) => code !== null
  );
  assert.ok(Date.now() - started < 7000);
  assert.equal(alive(run.pid), false);
  assert.equal(await exists(run.configFile), false);
  await assert.rejects(readFile(dirname(run.configFile)), { code: 'ENOENT' });
});

test('abrupt parent death closes IPC and cleans up the helper-owned connector', async (t) => {
  const f = await fixture(t, { ignoreTerm: true });
  f.message.preventTransform = true;
  const messageFile = join(f.directory, 'message.json');
  await writeFile(messageFile, JSON.stringify(f.message));
  const parent = fork(parentFile, [helperFile, messageFile], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  const messages: unknown[] = [];
  parent.on('message', (message: unknown) => messages.push(message));
  t.after(() => parent.kill('SIGKILL'));
  const [run] = await until(f.runs, (values) => values.length > 0);
  assert.ok(run);
  assert.notEqual(run.config.ingress[0].service, f.message.config.ingress[0].service);
  parent.kill('SIGKILL');
  await exited(parent);
  try {
    await until(
      () => exists(run.configFile),
      (value) => !value
    );
  } catch (error) {
    const owner = messages.find(
      (message) =>
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'parent-ready'
    );
    const helperPid =
      owner && typeof owner === 'object' && 'pid' in owner && typeof owner.pid === 'number'
        ? owner.pid
        : undefined;
    throw new Error(
      JSON.stringify({
        parentExitCode: parent.exitCode,
        parentSignal: parent.signalCode,
        helperPid,
        helperAlive: helperPid ? alive(helperPid) : undefined,
        connectorPid: run.pid,
        connectorAlive: alive(run.pid),
        configExists: await exists(run.configFile),
        messages
      }),
      { cause: error }
    );
  }
  assert.equal(alive(run.pid), false);
  await assert.rejects(fetch(run.config.ingress[0].service));
});

test('invalid start and missing executable report fixed codes without raw errors', async (t) => {
  const invalid = launch(t, { type: 'start', executable: 'secret-invalid-input' });
  await until(
    () => invalid.child.exitCode,
    (code) => code !== null
  );
  assert.deepEqual(invalid.statuses, [{ state: 'error', error: 'helper-protocol-error' }]);
  assert.equal(invalid.output(), '');
  const f = await fixture(t);
  const missing = launch(t, {
    ...f.message,
    executable: join(f.directory, 'missing-secret-executable')
  });
  await until(
    () => missing.statuses,
    (values) => values.some((status) => status.error === 'cloudflared-unavailable')
  );
  missing.child.send({ type: 'stop' });
  await until(
    () => missing.child.exitCode,
    (code) => code !== null
  );
  assert.equal(missing.output(), '');
});
