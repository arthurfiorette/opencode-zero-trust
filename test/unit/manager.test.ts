import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { tunnelOptionsSchema } from '../../src/config.js';
import { ConfigurationConflict, getManager } from '../../src/manager.js';

test('shares one manager across activations and refuses conflicting or invalid configuration', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zero-trust-manager-'));
  try {
    const options = tunnelOptionsSchema.parse({
      hostname: 'opencode.example.com',
      credentialsFile: path.join(directory, 'missing.json'),
      access: { teamName: 'my-team', audience: 'a'.repeat(64) }
    });
    const manager = getManager(options);
    assert.equal(manager, getManager({ ...options }));
    assert.throws(
      () => getManager({ ...options, hostname: 'other.example.com' }),
      ConfigurationConflict
    );
    assert.equal(await manager.pair(), undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let attempt = 0; manager.status().state === 'starting' && attempt < 200; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(manager.status().state, 'error');
    assert.equal(manager.status().error, 'credentials-invalid');
    assert.equal(manager.status().helperPid, undefined);
    assert.equal(manager.status().connectorPid, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
