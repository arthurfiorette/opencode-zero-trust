import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Plugin } from '@opencode/plugin/tui';
import type { SlotClaim } from '@opencode/plugin/tui/context';
import type { Status } from '../../src/rpc.js';
import { installSidebar } from '../../src/sidebar.js';
import { createSidebarState, type SidebarState } from '../../src/sidebar-state.js';

const ready: Status = { state: 'ready', url: 'https://example.com', dns: 'unchecked' };

test('sidebar appends to the public content slot and returns its unregister function', () => {
  const claims: SlotClaim[] = [];
  let removed = false;
  const unregister = () => {
    removed = true;
  };
  const cleanup = installSidebar({
    ui: {
      slot(claim: SlotClaim) {
        claims.push(claim);
        return unregister;
      }
    }
  } as unknown as Plugin.Context);
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.append, 'sidebar.content');
  assert.equal(typeof claims[0]?.render, 'function');
  assert.equal(cleanup, unregister);
  cleanup();
  assert.equal(removed, true);
});

test('expansion, collapse, and polling never request a pairing link', async () => {
  let issued = 0;
  let checked = 0;
  const rpc = {
    status: async () => {
      checked++;
      return ready;
    },
    pair: async () => {
      issued++;
      throw new Error('Sidebar must not pair');
    }
  };
  const controller = createSidebarState(rpc, () => {});
  await controller.refresh();
  controller.toggle();
  assert.equal(controller.snapshot().expanded, true);
  await controller.refresh();
  controller.toggle();
  await controller.refresh();
  controller.toggle();
  assert.equal(checked, 3);
  assert.equal(issued, 0);
  controller.dispose();
});

test('identical background status polls publish nothing and retain status identity', async () => {
  const updates: SidebarState[] = [];
  const controller = createSidebarState({ status: async () => ({ ...ready }) }, (state) =>
    updates.push(state)
  );
  await controller.refresh();
  const status = controller.snapshot().status;
  controller.toggle();
  const publications = updates.length;
  await controller.refresh();
  await controller.refresh();
  assert.equal(updates.length, publications);
  assert.equal(controller.snapshot().status, status);
  controller.dispose();
});

test('status failures are sanitized and a successful poll clears the error', async () => {
  let failed = true;
  const controller = createSidebarState(
    {
      status: async () => {
        if (failed) throw new Error('secret credential and pairing URL');
        return ready;
      }
    },
    () => {}
  );
  await controller.refresh();
  assert.equal(controller.snapshot().status, undefined);
  assert.equal(controller.snapshot().message, 'Status unavailable. Check the server plugin.');
  failed = false;
  await controller.refresh();
  assert.equal(controller.snapshot().status, ready);
  assert.equal(controller.snapshot().message, undefined);
  controller.dispose();
});

test('polls cannot overlap and disposal ignores late status responses', async () => {
  let resolve!: (status: Status) => void;
  let calls = 0;
  const updates: SidebarState[] = [];
  const controller = createSidebarState(
    {
      status: () => {
        calls++;
        return new Promise((done) => (resolve = done));
      }
    },
    (state) => updates.push(state)
  );
  const pending = controller.refresh();
  await controller.refresh();
  assert.equal(calls, 1);
  controller.dispose();
  resolve(ready);
  await pending;
  controller.toggle();
  await controller.refresh();
  assert.equal(calls, 1);
  assert.equal(updates.length, 0);
  assert.deepEqual(controller.snapshot(), { expanded: false });
});
