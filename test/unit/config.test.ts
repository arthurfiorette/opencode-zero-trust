import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
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
  assert.throws(() => parseOptions({ hostname: complete.hostname }));
  assert.throws(() => parseOptions({ ...complete, access: undefined }));
  assert.throws(() => parseOptions({ ...complete, credentialsFile: 'relative.json' }));
  assert.throws(() =>
    parseOptions({ ...complete, access: { ...complete.access, teamName: 'https://my-team' } })
  );
  assert.throws(() =>
    parseOptions({ ...complete, access: { ...complete.access, audience: 'wrong-audience' } })
  );
  assert.throws(() => parseOptions({ ...complete, cloudflaredPath: 'cloudflared --token secret' }));
});

test('rejects unknown options instead of silently accepting misspelled security settings', () => {
  assert.throws(() => parseOptions({ hostnmae: 'opencode.example.com' }), { name: 'ZodError' });
  assert.throws(() => parseOptions({ password: 'not-a-supported-option' }), { name: 'ZodError' });
});
