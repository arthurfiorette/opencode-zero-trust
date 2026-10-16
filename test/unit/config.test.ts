import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import os, { homedir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ZodError } from 'zod';
import { parseOptions } from '../../src/config.js';

const complete = {
  hostname: 'opencode-mac.example.com',
  credentialsFile: path.resolve('credentials.json'),
  access: { teamName: 'my-team', audience: 'a'.repeat(64) }
};

test('loads without options so one package entry is sufficient', () => {
  assert.equal(parseOptions({}), undefined);
});

test('accepts and normalizes a DNS hostname', () => {
  assert.deepEqual(parseOptions({ ...complete, hostname: 'OpenCode-Mac.Example.COM' }), {
    ...complete,
    autoDns: true,
    autoStart: true,
    preventTransform: false,
    cloudflaredPath: 'cloudflared',
    nodePath: 'node'
  });
});

test('rejects URLs, IP addresses, wildcards, and malformed DNS names', () => {
  for (const hostname of [
    '',
    'https://opencode.example.com',
    'opencode.example.com/path',
    'opencode.example.com:443',
    '127.0.0.1',
    '::1',
    'localhost',
    '*.example.com',
    '-opencode.example.com',
    'opencode..example.com'
  ]) {
    assert.throws(() => parseOptions({ ...complete, hostname }), { name: 'ZodError' }, hostname);
  }
});

test('requires a complete configuration before enabling exposure', () => {
  assert.throws(() => parseOptions({ credentialsFile: complete.credentialsFile }));
  assert.throws(() => parseOptions({ ...complete, credentialsFile: 'relative.json' }));
  assert.throws(() =>
    parseOptions({ ...complete, access: { ...complete.access, teamName: 'https://my-team' } })
  );
  assert.throws(() =>
    parseOptions({ ...complete, access: { ...complete.access, audience: 'wrong-audience' } })
  );
  assert.throws(() => parseOptions({ ...complete, cloudflaredPath: 'cloudflared --token secret' }));
});

test('accepts hostname-only configuration with automatic credentials discovery', () => {
  assert.deepEqual(parseOptions({ hostname: complete.hostname }), {
    hostname: complete.hostname,
    autoDns: true,
    autoStart: true,
    preventTransform: false,
    cloudflaredPath: 'cloudflared',
    nodePath: 'node'
  });
});

test('allows automatic DNS routing to be explicitly disabled', () => {
  assert.equal(parseOptions({ hostname: complete.hostname, autoDns: false })?.autoDns, false);
  assert.throws(() => parseOptions({ hostname: complete.hostname, autoDns: 'false' }), {
    name: 'ZodError'
  });
});

test('allows startup only after explicit connection', () => {
  assert.equal(parseOptions({ hostname: complete.hostname, autoStart: false })?.autoStart, false);
  assert.throws(() => parseOptions({ hostname: complete.hostname, autoStart: 'false' }), {
    name: 'ZodError'
  });
});

test('enables the no-transform proxy only with an explicit boolean option', () => {
  assert.equal(parseOptions({ hostname: complete.hostname })?.preventTransform, false);
  assert.equal(
    parseOptions({ hostname: complete.hostname, preventTransform: true })?.preventTransform,
    true
  );
  assert.throws(() => parseOptions({ hostname: complete.hostname, preventTransform: 'true' }), {
    name: 'ZodError'
  });
});

test('hostname variables support first and last character limits', (context) => {
  context.mock.method(os, 'hostname', () => 'Build Mác.local');
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.equal(
    parseOptions({ hostname: '{hostname}.example.com' })?.hostname,
    'build-mac-local.example.com'
  );
  assert.equal(
    parseOptions({ hostname: '{hostname,5}.example.com' })?.hostname,
    'build.example.com'
  );
  assert.equal(
    parseOptions({ hostname: '{hostname,-5}.example.com' })?.hostname,
    'local.example.com'
  );
  for (const expression of [
    'hostname,0',
    'hostname,64',
    'hostname,-64',
    'hostname,1.5',
    'hostname,foo',
    'hostname,',
    'hostname,5,2'
  ]) {
    assert.throws(() => parseOptions({ hostname: `{${expression}}.example.com` }), {
      name: 'ZodError'
    });
  }
});

test('long machine names require explicit truncation to satisfy DNS label limits', (context) => {
  context.mock.method(os, 'hostname', () => 'a'.repeat(80));
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.throws(() => parseOptions({ hostname: '{hostname}.example.com' }), { name: 'ZodError' });
  assert.equal(
    parseOptions({ hostname: '{hostname,5}.example.com' })?.hostname,
    'aaaaa.example.com'
  );
});

test('expands credentialsFile home paths while preserving absolute paths', () => {
  const cases = [
    ['~/.cloudflared/tunnel.json', path.join(homedir(), '.cloudflared', 'tunnel.json')],
    ['~', homedir()],
    [complete.credentialsFile, complete.credentialsFile]
  ];
  if (path.sep === '\\')
    cases.push([
      '~\\.cloudflared\\tunnel.json',
      path.join(homedir(), '.cloudflared', 'tunnel.json')
    ]);
  for (const [credentialsFile, expected] of cases) {
    assert.equal(parseOptions({ ...complete, credentialsFile })?.credentialsFile, expected);
  }
  for (const credentialsFile of [
    'relative.json',
    '~other/.cloudflared/tunnel.json',
    '$HOME/.cloudflared/tunnel.json'
  ]) {
    assert.throws(() => parseOptions({ ...complete, credentialsFile }), { name: 'ZodError' });
  }
});

for (const [platform, expected] of [
  ['darwin', 'macos'],
  ['win32', 'windows'],
  ['linux', 'linux']
] as const) {
  test(`resolves local hostname variables as DNS labels on ${platform}`, (context) => {
    const user = os.userInfo();
    context.mock.method(os, 'hostname', () => 'Build Mác.local');
    context.mock.method(os, 'userInfo', () => ({ ...user, username: 'Árthur_Dev' }));
    context.mock.method(os, 'platform', () => platform);
    syncBuiltinESMExports();
    context.after(() => {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    assert.equal(
      parseOptions({ hostname: '{username}.{hostname}.{os}.example.com' })?.hostname,
      `arthur-dev.build-mac-local.${expected}.example.com`
    );
  });
}

test('rejects unknown and malformed hostname variables', () => {
  for (const hostname of [
    'oc-{home}.example.com',
    '{constructor}.example.com',
    '{__proto__}.example.com',
    'oc-{username.example.com'
  ]) {
    assert.throws(() => parseOptions({ hostname }), { name: 'ZodError' });
  }
});

test('reports missing hostname instead of treating configured keys as unknown', () => {
  assert.throws(
    () => parseOptions({ credentialsFile: complete.credentialsFile }),
    (error: unknown) => {
      assert.ok(error instanceof ZodError);
      assert.ok(
        error.issues.some((issue) => issue.path[0] === 'hostname' && issue.code === 'invalid_type')
      );
      return true;
    }
  );
});

test('allows native authentication without configuring Cloudflare Access', () => {
  assert.deepEqual(
    parseOptions({ hostname: complete.hostname, credentialsFile: complete.credentialsFile }),
    {
      hostname: complete.hostname,
      autoDns: true,
      autoStart: true,
      preventTransform: false,
      credentialsFile: complete.credentialsFile,
      cloudflaredPath: 'cloudflared',
      nodePath: 'node'
    }
  );
});

test('requires both valid Access fields when Access is configured', () => {
  for (const access of [
    {},
    { teamName: complete.access.teamName },
    { audience: complete.access.audience },
    null,
    false
  ]) {
    assert.throws(() => parseOptions({ ...complete, access }), { name: 'ZodError' });
  }
});

test('rejects unknown options instead of silently accepting misspelled security settings', () => {
  assert.throws(() => parseOptions({ hostnmae: 'opencode.example.com' }), { name: 'ZodError' });
  assert.throws(() => parseOptions({ password: 'not-a-supported-option' }), { name: 'ZodError' });
});
