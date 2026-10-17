import { spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';
import { RGBA, TextBuffer } from '@opentui/core';
import { testRender } from '@opentui/solid';
import { jsx } from '@opentui/solid/jsx-runtime';
import { createSignal } from 'solid-js';
import { encode } from 'uqr';
import { showQrDialog } from '../../dist/qr-dialog.js';

test('QR-only dialog mounts cold, encodes the URL, and discards an expired QR', async () => {
  const [view, setView] = createSignal();
  const copied = [];
  const commands = [];
  const pairing = {
    url: `https://oc-mac.arthur.one/auth/connect/${'a'.repeat(22)}`,
    expiresIn: 300
  };
  const context = {
    renderer: {
      width: 100,
      height: 60,
      copyToClipboardOSC52(text) {
        copied.push(text);
        return true;
      }
    },
    keymap: {
      layer(factory) {
        commands.push(...factory().commands);
      }
    },
    theme: {
      text: { base: '#dcc89b', muted: '#aaaaaa' },
      background: { raised: { base: '#202321' } }
    },
    ui: {
      dialog: {
        show(render) {
          setView(() => render);
        },
        set(options) {
          assert.deepEqual(options, { size: 'medium', centered: true });
        },
        alert() {
          throw new Error('Unexpected alert');
        }
      }
    }
  };
  const rendered = await testRender(
    () =>
      jsx('box', {
        width: '100%',
        height: '100%',
        get children() {
          return view()?.();
        }
      }),
    { width: 100, height: 60 }
  );
  try {
    await showQrDialog(context, pairing, Date.now());
    // showQrDialog must load the panel cold before mounting its renderables.
    await rendered.waitForFrame((frame) => frame.includes('█'));
    const frame = rendered.captureCharFrame();
    for (const unwanted of [
      'Connector:',
      'DNS:',
      'Hostname:',
      'https://',
      'Single-use',
      'Valid for'
    ]) {
      assert.ok(!frame.includes(unwanted));
    }
    const qrNode = rendered.renderer.root.findDescendantById('zero-trust-pairing-qr');
    assert.ok(qrNode);
    assert.deepEqual(qrNode.fg.toInts(), RGBA.fromHex('#dcc89b').toInts());
    assert.deepEqual(qrNode.bg.toInts(), RGBA.fromHex('#202321').toInts());
    const matrix = encode(pairing.url, { border: 4, ecc: 'M' });
    assert.equal(qrNode.width, matrix.size);
    const expectedRows = Math.ceil(matrix.size / 2);
    assert.equal(frame.split('\n').filter((row) => /[▀▄█]/.test(row)).length, expectedRows);
    const rows = frame
      .split('\n')
      .slice(qrNode.y, qrNode.y + expectedRows)
      .map((row) => row.slice(qrNode.x, qrNode.x + matrix.size));
    const modules = rows
      .flatMap((row) => {
        const cells = [...row].map((cell) => {
          switch (cell) {
            case '█':
              return [false, false];
            case '▀':
              return [false, true];
            case '▄':
              return [true, false];
            case ' ':
              return [true, true];
            default:
              throw new Error('Unexpected QR glyph');
          }
        });
        return [cells.map((cell) => cell[0]), cells.map((cell) => cell[1])];
      })
      .slice(0, matrix.size);
    assert.deepEqual(
      modules,
      matrix.data,
      'The displayed QR must encode the pairing URL, not diagnostic text.'
    );
    const copy = rendered.renderer.root.findDescendantById('zero-trust-copy-link');
    assert.ok(copy);
    await rendered.mockMouse.pressDown(copy.x + 2, copy.y);
    assert.equal(copied.length, 0);
    await rendered.mockMouse.release(copy.x + 2, copy.y);
    assert.deepEqual(copied, [pairing.url]);
    await rendered.waitForFrame((frame) => frame.includes('Copied'));
    const first = qrNode.id;
    await showQrDialog(context, pairing, Date.now() - 301_000);
    await rendered.waitForFrame((frame) => frame.includes('QR code expired'));
    assert.ok(!rendered.captureCharFrame().includes('█'));
    assert.equal(rendered.renderer.root.findDescendantById(first) === qrNode, false);
    assert.ok(!rendered.captureCharFrame().includes('Copy link'));
    const expiredCopy = commands.at(-1);
    assert.equal(expiredCopy.enabled(), false);
    expiredCopy.run();
    assert.equal(copied.length, 1, 'Expired links must not be copied.');
  } finally {
    rendered.renderer.destroy();
  }
});

for (const outcome of ['copied', 'expired', 'cancelled', 'clipboard-failed']) {
  test(`QR render failure recovers through the host dialog: ${outcome}`, async () => {
    const [view, setView] = createSignal();
    const copied = [];
    const toasts = [];
    const selections = [];
    let cleared = 0;
    const pairing = {
      url: `https://oc.example.com/auth/connect/${'b'.repeat(22)}`,
      expiresIn: 300
    };
    const context = {
      renderer: {
        width: 100,
        height: 60,
        copyToClipboardOSC52(url) {
          if (outcome === 'clipboard-failed') return false;
          copied.push(url);
          return true;
        }
      },
      theme: {
        text: { base: '#dcc89b', muted: '#aaaaaa' },
        background: { raised: { base: '#202321' } }
      },
      keymap: { layer() {} },
      ui: {
        toast: { show: (toast) => toasts.push(toast) },
        dialog: {
          show: (render) => setView(() => render),
          set() {},
          clear() {
            cleared++;
            setView(undefined);
          },
          async select(options) {
            selections.push(options);
            return outcome === 'cancelled' ? undefined : 'copy';
          }
        }
      }
    };
    const rendered = await testRender(
      () =>
        jsx('box', {
          width: '100%',
          height: '100%',
          get children() {
            return view()?.();
          }
        }),
      { width: 100, height: 60 }
    );
    // Exercise the real panel and Solid error boundary, not a substitute panel.
    const buffer = spyOn(TextBuffer, 'create').mockImplementationOnce(() => {
      throw new Error('Failed to create TextBuffer');
    });
    try {
      await showQrDialog(context, pairing, Date.now() - (outcome === 'expired' ? 301_000 : 0));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(buffer.mock.calls.length, 1);
      assert.equal(cleared, 1);
      assert.equal(selections.length, 1);
      assert.equal(selections[0].options[0].value, 'copy');
      assert.deepEqual(copied, outcome === 'copied' ? [pairing.url] : []);
      if (outcome === 'cancelled') assert.equal(toasts.length, 0);
      else {
        assert.equal(toasts.length, 1);
        assert.equal(toasts[0].variant, outcome === 'copied' ? 'success' : 'error');
      }
      assert.ok(!JSON.stringify({ toasts, selections }).includes(pairing.url));
    } finally {
      buffer.mockRestore();
      rendered.renderer.destroy();
    }
  });
}
