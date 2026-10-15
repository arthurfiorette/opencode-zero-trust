import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions } from '../../src/config.js';

test('loads without options so one package entry is sufficient', () => {
  assert.deepEqual(parseOptions({}), {});
});

test('accepts and normalizes a DNS hostname', () => {
  assert.deepEqual(parseOptions({ hostname: 'OpenCode-Mac.Example.COM' }), {
    hostname: 'opencode-mac.example.com'
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
    assert.throws(() => parseOptions({ hostname }), { name: 'ZodError' }, hostname);
  }
});

test('rejects unknown options instead of silently accepting misspelled security settings', () => {
  assert.throws(() => parseOptions({ hostnmae: 'opencode.example.com' }), { name: 'ZodError' });
  assert.throws(() => parseOptions({ password: 'not-a-supported-option' }), { name: 'ZodError' });
});
