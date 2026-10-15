import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { LocationRef } from '@opencode/client';
import { OpenCode } from '@opencode/sdk';
import plugin from '../../src/index.js';
import { type Status, ZeroTrust } from '../../src/rpc.js';

const directory = process.env.OPENCODE_TEST_ROOT;
assert.ok(directory, 'This fixture must run through the isolated integration test.');
const config = path.join(directory, 'empty-config');
await mkdir(config);

const host = await OpenCode.create({
  database: { path: ':memory:' },
  config: { directory: config, project: false, content: '{}' },
  models: { fetch: false },
  fs: { filewatcher: false, fff: false },
  plugins: [plugin]
});

try {
  for (const name of ['first-project', 'second-project']) {
    const location: LocationRef = { directory: path.join(directory, name) };
    await mkdir(location.directory);
    await host.sessions.create({ location });
    const status: Status = await host.rpc(ZeroTrust).status({}, { location });
    assert.deepEqual(status, { state: 'not-implemented' });
  }

  console.log('OpenCode integration passed');
} finally {
  await host.close();
}
