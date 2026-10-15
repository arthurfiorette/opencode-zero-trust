import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'opencode zero trust package-'));
// Execute npm's JS entrypoint on Windows, avoiding cmd.exe argument splitting and escaping.
const npmCli =
  process.platform === 'win32'
    ? (process.env.PATH ?? '')
        .split(path.delimiter)
        .map((entry) => path.join(entry, 'node_modules/npm/bin/npm-cli.js'))
        .find((entry) => existsSync(entry))
    : undefined;

const run = (args, cwd) =>
  execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024
  });

try {
  assert.ok(process.platform !== 'win32' || npmCli, 'Cannot locate npm-cli.js on PATH.');
  const [packed] = JSON.parse(
    run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root)
  );
  assert.ok(packed);

  for (const name of ['index', 'tui', 'rpc']) {
    assert.ok(
      packed.files.some((file) => file.path === `dist/${name}.js`),
      `Missing ${name} runtime export`
    );
    assert.ok(
      packed.files.some((file) => file.path === `dist/${name}.d.ts`),
      `Missing ${name} type export`
    );
  }
  assert.ok(
    packed.files.every((file) => /^(dist\/|package\.json$|README\.md$|LICENSE$)/.test(file.path))
  );

  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' })
  );
  run(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      path.join(directory, packed.filename)
    ],
    directory
  );

  const manifest = JSON.parse(
    await readFile(path.join(directory, 'node_modules/opencode-zero-trust/package.json'), 'utf8')
  );
  assert.equal(manifest.name, 'opencode-zero-trust');

  await writeFile(
    path.join(directory, 'smoke.mjs'),
    `import assert from 'node:assert/strict';
import server from 'opencode-zero-trust';
import tui from 'opencode-zero-trust/tui';
import { ZeroTrust, statusSchema } from 'opencode-zero-trust/rpc';
assert.equal(server.id, 'opencode-zero-trust');
assert.equal(typeof server.setup, 'function');
assert.equal(tui.id, 'opencode-zero-trust.tui');
assert.equal(typeof tui.setup, 'function');
assert.ok(ZeroTrust);
assert.deepEqual(statusSchema.parse({ state: 'not-implemented' }), { state: 'not-implemented' });
`
  );

  execFileSync(process.execPath, ['smoke.mjs'], {
    cwd: directory,
    stdio: 'inherit',
    timeout: 30_000
  });
  console.log(`Verified packed exports: ${packed.filename}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
