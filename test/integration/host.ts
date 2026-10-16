import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export async function runHostFixture(name: string, flags: string[] = [], args: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'opencode-zero-trust-integration-'));
  try {
    return await promisify(execFile)(
      process.execPath,
      [
        ...flags,
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
        ...args
      ],
      {
        cwd: directory,
        timeout: 75_000,
        maxBuffer: 10 * 1024 * 1024,
        // Isolate paths before SDK import and do not inherit model keys or personal service settings.
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
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
