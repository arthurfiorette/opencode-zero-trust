import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { type TestContext, test } from 'node:test';
import { DnsError, ensureDNS } from '../../src/dns.js';
import { childEnvironment } from '../../src/environment.js';

const options = {
  hostname: 'opencode.example.test',
  tunnelID: '3b76428e-f99b-4cab-8394-af7b51da5891',
  cloudflaredPath: '/test/cloudflared'
};

type RouteExec = (
  file: string,
  args: readonly string[],
  options: childProcess.ExecFileOptions,
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => childProcess.ChildProcess;

function fixture(t: TestContext) {
  const negative = (): Promise<string[]> =>
    Promise.reject(Object.assign(new Error('private DNS detail'), { code: 'ENODATA' }));
  const a = t.mock.method(Resolver.prototype, 'resolve4', negative);
  const aaaa = t.mock.method(Resolver.prototype, 'resolve6', negative);
  const cname = t.mock.method(Resolver.prototype, 'resolveCname', negative);
  const cancel = t.mock.method(Resolver.prototype, 'cancel', () => {});
  const run: RouteExec = (_file, _args, _options, callback) => {
    assert.equal(typeof callback, 'function');
    callback(null, '', '');
    return new childProcess.ChildProcess();
  };
  const exec = t.mock.method(childProcess, 'execFile', run);
  return { a, aaaa, cname, cancel, exec };
}

for (const [type, records] of [
  ['a', ['192.0.2.1']],
  ['aaaa', ['2001:db8::1']],
  ['cname', ['existing.example.test']]
] as const) {
  test(`existing ${type} records leave DNS unchanged`, async (t) => {
    const mocks = fixture(t);
    mocks[type].mock.mockImplementation(async () => [...records]);
    assert.equal(await ensureDNS(options), 'resolved');
    assert.equal(mocks.exec.mock.callCount(), 0);
    assert.equal(mocks.cancel.mock.callCount(), 1);
    for (const query of [mocks.a, mocks.aaaa, mocks.cname]) {
      assert.deepEqual(query.mock.calls[0]?.arguments, [options.hostname]);
    }
  });
}

test('conclusive negative answers create one route without overwrite flags', async (t) => {
  const mocks = fixture(t);
  mocks.aaaa.mock.mockImplementation(() =>
    Promise.reject(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }))
  );
  assert.equal(await ensureDNS(options), 'created');
  assert.equal(mocks.exec.mock.callCount(), 1);
  const call = mocks.exec.mock.calls[0];
  assert.ok(call);
  const [file, args, execution] = call.arguments;
  assert.equal(file, options.cloudflaredPath);
  assert.deepEqual(args, ['tunnel', 'route', 'dns', options.tunnelID, options.hostname]);
  assert.deepEqual(execution, {
    shell: false,
    timeout: 20_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    env: childEnvironment()
  });
});

for (const code of ['ESERVFAIL', 'ETIMEOUT', 'EREFUSED', 'ECANCELLED']) {
  test(`${code} does not authorize DNS changes`, async (t) => {
    const mocks = fixture(t);
    mocks.a.mock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('private resolver detail'), { code }))
    );
    await assert.rejects(ensureDNS(options), (error: unknown) => {
      assert.ok(error instanceof DnsError);
      assert.equal(error.code, 'dns-check-failed');
      assert.equal(error.message, 'dns-check-failed');
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(mocks.exec.mock.callCount(), 0);
    assert.equal(mocks.cancel.mock.callCount(), 1);
  });
}

test('an existing record is sufficient even if another query fails transiently', async (t) => {
  const mocks = fixture(t);
  mocks.a.mock.mockImplementation(async () => ['192.0.2.1']);
  mocks.aaaa.mock.mockImplementation(() =>
    Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }))
  );
  assert.equal(await ensureDNS(options), 'resolved');
  assert.equal(mocks.exec.mock.callCount(), 0);
});

test('empty successful responses are not conclusive negative DNS errors', async (t) => {
  const mocks = fixture(t);
  mocks.a.mock.mockImplementation(async () => []);
  await assert.rejects(ensureDNS(options), { code: 'dns-check-failed' });
  assert.equal(mocks.exec.mock.callCount(), 0);
});

test('disabled startup cannot begin a DNS check or route command', async (t) => {
  const mocks = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(ensureDNS({ ...options, signal: controller.signal }), {
    code: 'dns-check-failed'
  });
  assert.equal(mocks.a.mock.callCount(), 0);
  assert.equal(mocks.exec.mock.callCount(), 0);
});

test('aborting a pending DNS lookup cannot create a route', async (t) => {
  const mocks = fixture(t);
  const controller = new AbortController();
  const rejectors: ((error: Error) => void)[] = [];
  for (const query of [mocks.a, mocks.aaaa, mocks.cname]) {
    query.mock.mockImplementation(
      () => new Promise<string[]>((_resolve, reject) => rejectors.push(reject))
    );
  }
  mocks.cancel.mock.mockImplementation(() => {
    for (const reject of rejectors)
      reject(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }));
  });
  const pending = ensureDNS({ ...options, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'dns-check-failed' });
  assert.equal(mocks.exec.mock.callCount(), 0);
});

for (const failure of ['exit', 'spawn', 'timeout', 'buffer']) {
  test(`${failure} command failures never expose captured output or raw errors`, async (t) => {
    const mocks = fixture(t);
    const secret = 'private-account-password-and-token';
    const fail: RouteExec = (_file, _args, _options, callback) => {
      assert.equal(typeof callback, 'function');
      const error = Object.assign(new Error(secret), {
        code: failure === 'spawn' ? 'ENOENT' : 1,
        killed: failure === 'timeout',
        stdout: secret,
        stderr: secret
      });
      if (failure === 'spawn') throw error;
      callback(error, secret, secret);
      return new childProcess.ChildProcess();
    };
    mocks.exec.mock.mockImplementation(fail);
    await assert.rejects(ensureDNS(options), (error: unknown) => {
      assert.ok(error instanceof DnsError);
      assert.equal(error.code, 'dns-route-failed');
      assert.equal(error.message, 'dns-route-failed');
      assert.equal(error.cause, undefined);
      assert.ok(!JSON.stringify(error).includes(secret));
      assert.ok(!String(error.stack).includes(secret));
      return true;
    });
    assert.equal(mocks.exec.mock.callCount(), 1);
  });
}
