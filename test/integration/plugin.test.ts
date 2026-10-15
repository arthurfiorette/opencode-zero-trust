import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('loads in a real OpenCode host and serves Location-scoped status RPCs', {
  timeout: 90_000
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opencode-zero-trust-integration-'));

  try {
    // Set isolation before importing the SDK, whose global paths are computed at module load.
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('../fixtures/opencode-host.ts', import.meta.url))
      ],
      {
        cwd: directory,
        timeout: 75_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          PATHEXT: process.env.PATHEXT,
          TEMP: directory,
          TMP: directory,
          HOME: directory,
          USERPROFILE: directory,
          APPDATA: path.join(directory, 'appdata'),
          LOCALAPPDATA: path.join(directory, 'localappdata'),
          XDG_CONFIG_HOME: path.join(directory, 'config'),
          XDG_DATA_HOME: path.join(directory, 'data'),
          XDG_STATE_HOME: path.join(directory, 'state'),
          XDG_CACHE_HOME: path.join(directory, 'cache'),
          OPENCODE_TEST_ROOT: directory
        }
      }
    );
    assert.match(result.stdout, /OpenCode integration passed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
