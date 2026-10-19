import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { MouseButton, RGBA } from '@opentui/core';
import { testRender } from '@opentui/solid';
import { jsx } from '@opentui/solid/jsx-runtime';
import { installSidebar } from '../../dist/sidebar.js';

test('cold sidebar has stable actions, hover contrast, release activation, and no automatic pairing', async () => {
  let claim;
  let issued = 0;
  let status = {
    state: 'ready',
    dns: 'resolved',
    hostname: 'oc-mac.arthur.one',
    url: 'https://oc-mac.arthur.one:443/auth/connect/secret'
  };
  let poll;
  const setInterval = globalThis.setInterval;
  globalThis.setInterval = (callback, milliseconds, ...args) => {
    if (milliseconds === 5000) poll = callback;
    return setInterval(callback, milliseconds, ...args);
  };
  const commands = [];
  const layers = [];
  const dispatched = [];
  let holdAction = false;
  let releaseAction;
  const runAction = async (command) => {
    dispatched.push(command);
    if (holdAction)
      await new Promise((resolve) => {
        releaseAction = resolve;
      });
  };
  const context = {
    location: { directory: '/fixture' },
    data: { location: { default: () => ({ directory: '/fixture' }) } },
    ui: {
      slot(value) {
        claim = value;
        return () => {};
      }
    },
    client: {
      rpc() {
        return {
          status: async () => ({ ...status }),
          pair: async () => {
            issued++;
            throw new Error('Sidebar must not pair');
          }
        };
      }
    },
    keymap: {
      layer(factory) {
        const layer = factory();
        layers.push(layer);
        commands.push(...layer.commands);
      },
      dispatch(id) {
        dispatched.push(id);
      }
    },
    theme: {
      text: {
        base: '#ffffff',
        muted: '#aaaaaa',
        feedback: {
          success: { base: '#00ff00' },
          warning: { base: '#ffff00' },
          error: { base: '#ff0000' }
        }
      }
    }
  };
  const unregister = installSidebar(context, {
    connect: () => runAction('opencode-zero-trust.connect'),
    disconnect: () => runAction('opencode-zero-trust.disable'),
    operation: () => undefined
  });
  const rendered = await testRender(
    () =>
      jsx('box', {
        width: '100%',
        height: '100%',
        get children() {
          return claim.render({ sessionID: 'fixture' });
        }
      }),
    { width: 37, height: 30 }
  );
  try {
    // Mount cold first, then wait for external module I/O; renderer idle does not mean lazy loading finished.
    await import('../../dist/sidebar-view.js');
    await rendered.waitForFrame((frame) => frame.includes('Zero Trust'));
    const find = (id) => rendered.renderer.root.findDescendantById(id);
    const click = (node, button = MouseButton.LEFT) =>
      rendered.mockMouse.click(node.x + 2, node.y, button);
    const white = RGBA.fromHex('#ffffff').toInts();
    const arrow = find('zero-trust-sidebar-header').getChildren()[0];
    assert.deepEqual(arrow.fg.toInts(), white, 'Collapsed arrow uses normal text color.');
    await click(find('zero-trust-sidebar-header'));
    await rendered.waitForFrame(
      (frame) => frame.includes('oc-mac.arthur.one') && frame.includes('Scan QR code')
    );
    globalThis.setInterval = setInterval;
    assert.deepEqual(arrow.fg.toInts(), white, 'Expanded arrow uses normal text color.');
    assert.equal(issued, 0);
    const names = ['scan', 'connect', 'details', 'disconnect'];
    const actions = names.map((name) => find(`zero-trust-sidebar-${name}`));
    assert.ok(actions.every(Boolean));
    const color = (name, suffix) => find(`zero-trust-sidebar-${name}-${suffix}`).fg.toInts();
    const grey = RGBA.fromHex('#aaaaaa').toInts();
    for (const name of ['scan', 'details', 'disconnect']) {
      assert.deepEqual(color(name, 'icon'), white);
      assert.deepEqual(color(name, 'label'), grey);
    }
    await rendered.mockMouse.moveTo(actions[0].x + 2, actions[0].y);
    await rendered.renderOnce();
    assert.deepEqual(color('scan', 'label'), white);
    assert.deepEqual(color('scan', 'icon'), white);
    await rendered.mockMouse.moveTo(35, 25);
    await rendered.renderOnce();
    assert.deepEqual(color('scan', 'label'), grey);
    assert.deepEqual(color('scan', 'icon'), white);
    assert.deepEqual(
      find('zero-trust-sidebar-status').fg.toInts(),
      RGBA.fromHex('#00ff00').toInts()
    );
    const frame = rendered.captureCharFrame();
    assert.ok(frame.includes('oc-mac.arthur.one'));
    const rows = frame.split('\n');
    const domainRow = rows.findIndex((row) => row.includes('oc-mac.arthur.one'));
    assert.equal(
      rows[domainRow + 1].trim(),
      '',
      'Separate hostname status from actions with a blank line.'
    );
    assert.ok(rows[domainRow + 2].includes('Scan QR code'));
    for (const absent of ['https://', ':443', '/auth/', 'secret', 'Refresh', '[', '█']) {
      assert.ok(!frame.includes(absent), absent);
    }
    assert.ok(poll);
    await poll();
    await poll();
    await rendered.renderOnce();
    names.forEach((name, index) => {
      assert.equal(find(`zero-trust-sidebar-${name}`), actions[index]);
    });
    for (const [index, command] of [
      [0, 'opencode-zero-trust.status'],
      [2, 'opencode-zero-trust.details'],
      [3, 'opencode-zero-trust.disable']
    ]) {
      const node = actions[index];
      const before = dispatched.length;
      await rendered.mockMouse.pressDown(node.x + 2, node.y, MouseButton.LEFT);
      assert.equal(dispatched.length, before, 'Mouse down must not open a dialog');
      await rendered.mockMouse.release(node.x + 2, node.y, MouseButton.LEFT);
      assert.equal(dispatched.length, before + 1);
      assert.equal(dispatched.at(-1), command);
      await click(node, MouseButton.RIGHT);
      await click(node, MouseButton.MIDDLE);
      assert.equal(dispatched.length, before + 1, 'Only left release activates actions');
    }
    status = { state: 'stopped', url: 'https://fallback.example.com:443/path?code=secret' };
    await poll();
    await rendered.waitForFrame(
      (frame) => frame.includes('fallback.example.com') && frame.includes('Connect')
    );
    assert.ok(rendered.captureCharFrame().includes('fallback.example.com'));
    assert.ok(!rendered.captureCharFrame().includes('Scan QR code'));
    assert.ok(!rendered.captureCharFrame().includes('Disconnect'));
    assert.deepEqual(find('zero-trust-sidebar-status').fg.toInts(), grey);
    await click(actions[1]);
    assert.equal(dispatched.at(-1), 'opencode-zero-trust.connect');
    await click(actions[2]);
    assert.equal(dispatched.at(-1), 'opencode-zero-trust.details');
    const longHostname = 'a-long-computer-name.with-a-long-hostname.example.com';
    status = { state: 'stopped', hostname: longHostname };
    await poll();
    rendered.resize(60, 30);
    await rendered.waitForFrame((frame) => frame.includes(longHostname));
    assert.equal(find('zero-trust-sidebar-hostname').height, 1);
    rendered.resize(24, 30);
    const shortened = `${longHostname.slice(0, 19)}...`;
    await rendered.waitForFrame((frame) => frame.includes(shortened));
    const narrowFrame = rendered.captureCharFrame();
    const hostnameRows = narrowFrame.split('\n').filter((line) => line.includes('a-long-computer'));
    assert.equal(hostnameRows.length, 1);
    assert.equal(hostnameRows[0].trimEnd(), `• ${shortened}`);
    assert.equal(find('zero-trust-sidebar-hostname').height, 1);
    assert.equal(find('zero-trust-sidebar-hostname').width, 22);
    assert.ok(!narrowFrame.includes('example.com'));
    assert.ok(!narrowFrame.includes('https://'));
    rendered.resize(60, 30);
    await rendered.waitForFrame((frame) => frame.includes(longHostname));
    const toggle = commands.find((command) => command.id === 'opencode-zero-trust.sidebar.toggle');
    assert.ok(toggle?.palette);
    assert.equal(layers[0].mode, 'global');
    assert.ok(!commands.some((command) => /refresh/i.test(command.id)));
    toggle.run();
    await rendered.waitForFrame((frame) => !frame.includes('Connect'));
    toggle.run();
    await rendered.waitForFrame((frame) => frame.includes('Connect'));
    assert.equal(issued, 0);
    holdAction = true;
    const before = dispatched.length;
    await click(actions[1]);
    assert.equal(dispatched.length, before + 1);
    await rendered.renderOnce();
    for (const name of ['connect', 'details']) {
      assert.deepEqual(color(name, 'icon'), grey, 'Pending action icons must look disabled.');
      assert.deepEqual(color(name, 'label'), grey);
    }
    assert.deepEqual(
      find('zero-trust-sidebar-status').fg.toInts(),
      RGBA.fromHex('#ffff00').toInts()
    );
    await click(actions[1]);
    await click(actions[2]);
    assert.equal(dispatched.length, before + 1, 'Pending connection disables all actions.');
    releaseAction();
    await rendered.waitFor(
      () => find('zero-trust-sidebar-status').fg.toInts().join() === grey.join()
    );
    status = { state: 'ready', hostname: 'oc-mac.arthur.one' };
    await poll();
    await rendered.waitForFrame((frame) => frame.includes('Disconnect'));
    const beforeDisconnect = dispatched.length;
    await click(actions[3]);
    await rendered.renderOnce();
    for (const name of ['scan', 'details', 'disconnect']) {
      assert.deepEqual(
        color(name, 'icon'),
        grey,
        'Disconnect confirmation disables action icons immediately.'
      );
      assert.deepEqual(color(name, 'label'), grey);
    }
    assert.deepEqual(
      find('zero-trust-sidebar-status').fg.toInts(),
      RGBA.fromHex('#ffff00').toInts()
    );
    await click(actions[3]);
    await click(actions[0]);
    assert.equal(
      dispatched.length,
      beforeDisconnect + 1,
      'Pending confirmation disables disconnect and QR actions.'
    );
    releaseAction();
    await rendered.waitFor(
      () =>
        find('zero-trust-sidebar-status').fg.toInts().join() ===
        RGBA.fromHex('#00ff00').toInts().join()
    );
    for (const state of ['starting', 'connecting', 'restarting', 'stopping']) {
      status = { state, hostname: 'oc-mac.arthur.one' };
      await poll();
      await rendered.renderOnce();
      const count = dispatched.length;
      for (const name of ['connect', 'details', 'disconnect']) {
        assert.deepEqual(color(name, 'icon'), grey, `${state} icons must remain disabled.`);
        assert.deepEqual(color(name, 'label'), grey);
      }
      await click(actions[1]);
      await click(actions[3]);
      assert.equal(dispatched.length, count);
    }
  } finally {
    globalThis.setInterval = setInterval;
    unregister();
    rendered.renderer.destroy();
  }
});
