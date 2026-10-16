import assert from 'node:assert/strict';
import { homedir, hostname, platform, userInfo } from 'node:os';
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

test('hostname variables support first and last character limits', () => {
  const full = parseOptions({ hostname: '{hostname}.example.com' })?.hostname.split('.')[0];
  assert.ok(full);
  assert.equal(
    parseOptions({ hostname: '{hostname,5}.example.com' })?.hostname,
    `${full.slice(0, 5).replace(/-+$/, '')}.example.com`
  );
  assert.equal(
    parseOptions({ hostname: '{hostname,-5}.example.com' })?.hostname,
    `${full.slice(-5).replace(/^-+/, '')}.example.com`
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

test('resolves local hostname variables as DNS labels', () => {
  const os =
    new Map([
      ['darwin', 'macos'],
      ['win32', 'windows'],
      ['linux', 'linux']
    ]).get(platform()) ?? platform();
  const resolved = parseOptions({ hostname: '{username}.{hostname}.{os}.example.com' });
  assert.ok(resolved);
  const labels = resolved.hostname.split('.');
  assert.equal(
    labels[0],
    userInfo()
      .username.normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
  assert.equal(
    labels[1],
    hostname()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
  assert.equal(labels[2], os);
  assert.match(resolved.hostname, /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+\.example\.com$/);
});

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
