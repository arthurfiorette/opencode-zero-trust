import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs, { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Service } from '@opencode/client/service';
import { tunnelOptionsSchema } from '../../src/config.js';
import { ConfigurationConflict, getManager, TunnelManager } from '../../src/manager.js';

test('shares one manager across activations and refuses conflicting or invalid configuration', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zero-trust-manager-'));
  try {
    const options = tunnelOptionsSchema.parse({
      hostname: 'opencode.example.com',
      autoStart: false,
      credentialsFile: path.join(directory, 'missing.json'),
      access: { teamName: 'my-team', audience: 'a'.repeat(64) }
    });
    const manager = getManager(options);
    assert.equal(manager.status().state, 'stopped');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal(manager.status().state, 'stopped');
    assert.equal(manager.status().error, undefined);
    assert.equal(manager, getManager({ ...options }));
    assert.throws(
      () => getManager({ ...options, hostname: 'other.example.com' }),
      ConfigurationConflict
    );
    assert.equal(await manager.pair(), undefined);
    const connecting = await Promise.all([manager.connect(), manager.connect()]);
    assert.equal(connecting[0]?.state, 'starting');
    assert.deepEqual(connecting[0], connecting[1]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let attempt = 0; manager.status().state === 'starting' && attempt < 200; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(manager.status().state, 'error');
    assert.equal(manager.status().error, 'credentials-invalid');
    assert.equal(manager.status().helperPid, undefined);
    assert.equal(manager.status().connectorPid, undefined);
    const stopped = await manager.disable();
    assert.equal(stopped.state, 'stopped');
    assert.equal(stopped.error, undefined);
    assert.deepEqual(await manager.disable(), stopped);
    assert.equal(getManager({ ...options }), manager);
    assert.deepEqual(getManager(options).status(), stopped);
    assert.equal(await manager.pair(), undefined);
    const reconnecting = manager.connect();
    const disconnecting = manager.disable();
    assert.equal((await reconnecting).state, 'starting');
    assert.equal((await disconnecting).state, 'stopped');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(manager.status(), stopped);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const staleFailure of [false, true]) {
  test(`connect serializes disable and ignores stale credential ${staleFailure ? 'failure' : 'success'}`, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'zero-trust-manager-reconnect-'));
    const credentialsFile = path.join(directory, 'credentials.json');
    const originalStat = fs.stat;
    const originalReadFile = fs.readFile;
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let reads = 0;
    let discoveryReads = 0;
    try {
      await writeFile(
        credentialsFile,
        JSON.stringify({
          AccountTag: 'account',
          TunnelSecret: 'secret',
          TunnelID: '00000000-0000-4000-8000-000000000001'
        }),
        { mode: 0o600 }
      );
      context.mock.method(fs, 'stat', async (file: string) => {
        if (file !== credentialsFile) return originalStat(file);
        reads++;
        if (reads === 1) {
          entered();
          await pending;
          if (staleFailure) throw new Error('Old initialization failed.');
        }
        return originalStat(file);
      });
      context.mock.method(fs, 'readFile', (file: string, encoding: 'utf8') => {
        if (file === path.join(directory, 'missing-service.json')) discoveryReads++;
        return originalReadFile(file, encoding);
      });
      syncBuiltinESMExports();
      const manager = new TunnelManager(
        tunnelOptionsSchema.parse({
          hostname: 'opencode.example.com',
          credentialsFile,
          serviceFile: path.join(directory, 'missing-service.json'),
          autoDns: false,
          autoStart: false
        })
      );
      assert.equal((await manager.connect()).state, 'starting');
      await started;
      const disabling = manager.disable();
      const connecting = manager.connect();
      const duplicate = manager.connect();
      assert.equal(manager.status().state, 'stopping');
      assert.equal((await disabling).state, 'stopped');
      assert.equal((await connecting).state, 'starting');
      assert.equal((await duplicate).state, 'starting');
      for (let attempt = 0; manager.status().state === 'starting' && attempt < 200; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(manager.status().error, 'daemon-unavailable');
      assert.equal(discoveryReads, 1);
      assert.equal(reads, 2);
      release();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assert.equal(manager.status().error, 'daemon-unavailable');
      assert.equal(discoveryReads, 1);
      assert.equal(manager.status().helperPid, undefined);
      assert.equal((await manager.disable()).state, 'stopped');
    } finally {
      release();
      context.mock.restoreAll();
      syncBuiltinESMExports();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('disable during credential initialization prevents startup and preserves stopped state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zero-trust-manager-stop-'));
  try {
    const credentialsFile = path.join(directory, 'credentials.json');
    await writeFile(
      credentialsFile,
      JSON.stringify({
        AccountTag: 'account',
        TunnelSecret: 'secret',
        TunnelID: '00000000-0000-4000-8000-000000000001'
      }),
      { mode: 0o600 }
    );
    for (const file of [credentialsFile, path.join(directory, 'missing.json')]) {
      const manager = new TunnelManager(
        tunnelOptionsSchema.parse({
          hostname: 'opencode.example.com',
          credentialsFile: file,
          serviceFile: path.join(directory, 'missing-service.json'),
          autoDns: false
        })
      );
      const disabling = manager.disable();
      assert.equal(manager.status().state, 'stopping');
      const stopped = await disabling;
      assert.equal(stopped.state, 'stopped');
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(manager.status(), stopped);
      assert.equal(stopped.helperPid, undefined);
      assert.equal(stopped.connectorPid, undefined);
      assert.deepEqual(await manager.disable(), stopped);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const shutdown of ['confirmed', 'unexpected', 'uncertain'] as const) {
  test(`connect preserves owned-helper safety after ${shutdown} shutdown`, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'zero-trust-manager-helper-'));
    const credentialsFile = path.join(directory, 'credentials.json');
    const serviceFile = path.join(directory, 'service.json');
    const helpers: (EventEmitter & { connected: boolean })[] = [];
    let launched: () => void = () => {};
    const launch = new Promise<void>((resolve) => {
      launched = resolve;
    });
    try {
      await writeFile(
        credentialsFile,
        JSON.stringify({
          AccountTag: 'account',
          TunnelSecret: 'secret',
          TunnelID: '00000000-0000-4000-8000-000000000001'
        }),
        { mode: 0o600 }
      );
      await writeFile(
        serviceFile,
        JSON.stringify({ url: 'http://127.0.0.1:4096', pid: process.pid })
      );
      context.mock.method(Service, 'discover', async () => ({
        url: 'http://127.0.0.1:4096',
        auth: { type: 'basic', username: 'opencode', password: 'test-only' }
      }));
      context.mock.method(globalThis, 'fetch', async () =>
        Response.json({
          version: '2.0.29',
          pid: process.pid,
          urls: [],
          paths: { tmp: directory }
        })
      );
      context.mock.method(childProcess, 'fork', () => {
        const helper = Object.assign(new EventEmitter(), {
          pid: process.pid + 1,
          connected: true,
          disconnect() {
            this.connected = false;
          },
          send(_message: unknown, callback?: (error: Error | null) => void) {
            callback?.(null);
          },
          unref() {}
        });
        helpers.push(helper);
        launched();
        return helper;
      });
      syncBuiltinESMExports();
      const manager = new TunnelManager(
        tunnelOptionsSchema.parse({
          hostname: 'opencode.example.com',
          credentialsFile,
          serviceFile,
          autoDns: false,
          autoStart: false
        })
      );
      assert.equal((await manager.connect()).state, 'starting');
      await launch;
      const helper = helpers[0];
      assert.ok(helper);
      helper.emit('message', { state: 'ready', pid: process.pid + 2 });
      assert.equal((await manager.connect()).state, 'ready');
      assert.equal(helpers.length, 1);
      if (shutdown === 'unexpected') {
        helper.emit('exit', null, 'SIGKILL');
        assert.equal(manager.status().error, 'helper-unavailable');
        await assert.rejects(manager.connect());
        await assert.rejects(manager.disable());
        await assert.rejects(manager.connect());
      } else {
        if (shutdown === 'uncertain') context.mock.timers.enable({ apis: ['setTimeout'] });
        let stopped = false;
        const disabling = manager.disable().then((status) => {
          stopped = true;
          return status;
        });
        assert.equal(helper.connected, false);
        assert.equal(manager.status().state, 'stopping');
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(stopped, false);
        if (shutdown === 'uncertain') {
          const rejected = assert.rejects(disabling);
          context.mock.timers.tick(5000);
          await rejected;
          helper.emit('exit', 0, null);
          await assert.rejects(manager.connect());
        } else {
          const reconnecting = manager.connect();
          helper.emit('exit', 0, null);
          assert.equal((await disabling).state, 'stopped');
          assert.equal((await reconnecting).state, 'starting');
          for (let attempt = 0; helpers.length < 2 && attempt < 200; attempt++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(helpers.length, 2);
          const stopping = manager.disable();
          helpers[1]?.emit('exit', 0, null);
          assert.equal((await stopping).state, 'stopped');
        }
      }
      assert.equal(helpers.length, shutdown === 'confirmed' ? 2 : 1);
    } finally {
      context.mock.restoreAll();
      context.mock.timers.reset();
      syncBuiltinESMExports();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
