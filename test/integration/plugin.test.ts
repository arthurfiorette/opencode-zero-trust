import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runHostFixture } from './host.js';

test('loads in a real OpenCode host and serves Location-scoped status RPCs', {
  timeout: 90_000
}, async () => {
  const result = await runHostFixture('opencode-host.ts');
  assert.match(result.stdout, /OpenCode integration passed/);
});

test('configured SDK host owns one connector across reloads and issues native pairing', {
  timeout: 90_000
}, async () => {
  const result = await runHostFixture('configured-host.mjs', ['--experimental-test-module-mocks']);
  assert.match(result.stdout, /Configured OpenCode integration passed/);
});
