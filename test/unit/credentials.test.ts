import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findCredentialsFile, readTunnelID } from '../../src/credentials.js';

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

test('discovers a sole tunnel JSON and refuses missing or ambiguous credentials', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zero-trust-discovery-'));
  const first = path.join(directory, '6ebbf456-fce2-47a4-845f-06bc17f7f130.json');
  const second = path.join(directory, '44a8ba75-2cd0-441a-97d5-9ea0de014346.json');
  try {
    await writeFile(path.join(directory, 'cert.pem'), 'not-tunnel-credentials');
    await writeFile(path.join(directory, 'config.json'), '{}');
    await mkdir(path.join(directory, '2389c7ee-8742-4c72-86e7-cee82d50a8f8.json'));
    await assert.rejects(findCredentialsFile(directory), { code: 'credentials-invalid' });
    await writeFile(first, '{}');
    assert.equal(await findCredentialsFile(directory), first);
    await writeFile(second, '{}');
    await assert.rejects(findCredentialsFile(directory), { code: 'credentials-ambiguous' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
