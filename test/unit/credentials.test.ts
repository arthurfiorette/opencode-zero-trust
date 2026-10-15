import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readTunnelID } from '../../src/credentials.js';

test('reads only the tunnel identity and rejects malformed or exposed credential files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zero-trust-credentials-'));
  const file = path.join(directory, 'tunnel.json');
  const id = '6ebbf456-fce2-47a4-845f-06bc17f7f130';
  try {
    await writeFile(
      file,
      JSON.stringify({ AccountTag: 'account', TunnelID: id, TunnelSecret: 'test-only-secret' }),
      { mode: 0o600 }
    );
    assert.equal(await readTunnelID(file), id);
    await writeFile(file, '{"TunnelSecret":"secret-value",invalid-json');
    await assert.rejects(readTunnelID(file), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'credentials-invalid');
      assert.ok(!String(error).includes('secret-value'));
      return true;
    });
    if (process.platform !== 'win32') {
      await chmod(file, 0o644);
      await assert.rejects(readTunnelID(file), { message: 'credentials-permissions' });
    }
    await assert.rejects(readTunnelID(directory), { message: 'credentials-invalid' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
