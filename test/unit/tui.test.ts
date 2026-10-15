import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Plugin } from '@opencode/plugin/tui';
import type { DialogAlertOptions, DialogOptions, KeymapLayer } from '@opencode/plugin/tui/context';
import { encode } from 'uqr';
import { type Pairing, type Status, ZeroTrust } from '../../src/rpc.js';
import plugin from '../../src/tui.js';

const location = { directory: '/workspace/project' };
const pairing: Pairing = {
  url: 'https://opencode-mac.example.com/?code=single-use-code',
  expiresIn: 120
};
const ready: Status = {
  state: 'ready',
  hostname: 'opencode-mac.example.com',
  url: 'https://opencode-mac.example.com',
  helperPid: 1234,
  connectorPid: 5678
};

async function host(
  options: {
    explicit?: boolean;
    status?: Status;
    statusError?: unknown;
    pairError?: unknown;
    pairing?: Pairing;
    width?: number;
    height?: number;
  } = {}
) {
  const layers: KeymapLayer[] = [];
  const dialogs: DialogAlertOptions[] = [];
  const sizes: DialogOptions[] = [];
  const requests: unknown[] = [];
  const context = {
    location: options.explicit ? location : undefined,
    renderer: { width: options.width ?? 140, height: options.height ?? 80 },
    data: {
      location: {
        default() {
          assert.ok(!options.explicit, 'Explicit Locations must not be replaced by the default.');
          return location;
        }
      }
    },
    keymap: {
      layer(factory: () => KeymapLayer) {
        layers.push(factory());
      }
    },
    client: {
      rpc(definition: typeof ZeroTrust) {
        assert.equal(definition, ZeroTrust);
        return {
          async status(input: unknown, callOptions: unknown) {
            requests.push({ method: 'status', input, options: callOptions });
            if ('statusError' in options) throw options.statusError;
            return options.status ?? { state: 'unconfigured' };
          },
          async pair(input: unknown, callOptions: unknown) {
            requests.push({ method: 'pair', input, options: callOptions });
            if ('pairError' in options) throw options.pairError;
            return options.pairing ?? pairing;
          }
        };
      }
    },
    ui: {
      dialog: {
        async alert(value: DialogAlertOptions) {
          dialogs.push(value);
          sizes.length = 0;
        },
        set(value: DialogOptions) {
          assert.equal(dialogs.length, 1, 'Size must be set after the alert resets presentation.');
          sizes.push(value);
        }
      }
    }
  };

  // Simulate only public host boundaries; the integration suite covers RPC transport.
  await plugin.setup(context as unknown as Plugin.Context);
  const command = layers[0]?.commands?.find((item) => item.id === 'opencode-zero-trust.status');
  assert.ok(command);
  assert.deepEqual(requests, [], 'Registration must not request pairing or start a tunnel.');
  return {
    command,
    requests,
    dialogs,
    sizes,
    async run() {
      await command.run();
      assert.equal(dialogs.length, 1);
      assert.deepEqual(sizes, [{ size: 'xlarge', centered: true }]);
      return dialogs[0]!.message;
    }
  };
}

for (const explicit of [true, false]) {
  test(`registers /zero-trust and uses the ${explicit ? 'explicit' : 'default'} Location`, async () => {
    const terminal = await host({ explicit, status: ready });
    assert.equal(terminal.command.palette, true);
    assert.equal(terminal.command.title, 'Show Zero Trust status');
    assert.deepEqual(terminal.command.slash, { name: 'zero-trust' });
    await terminal.run();
    assert.deepEqual(terminal.requests, [
      { method: 'status', input: {}, options: { location } },
      { method: 'pair', input: {}, options: { location } }
    ]);
  });
}

for (const state of ['unconfigured', 'starting', 'connecting', 'restarting', 'error'] as const) {
  test(`shows ${state} without requesting a pairing code`, async () => {
    const terminal = await host({ status: { ...ready, state } });
    const message = await terminal.run();
    assert.match(message, new RegExp(`Status: ${state}`));
    assert.match(message, /Hostname: opencode-mac.example.com/);
    assert.match(message, /Public URL: https:\/\/opencode-mac.example.com/);
    assert.match(message, /Helper PID: 1234/);
    assert.match(message, /Connector PID: 5678/);
    assert.equal(terminal.requests.length, 1);
    assert.doesNotMatch(message, /single-use-code|[▀▄█]/);
  });
}

test('shows configuration guidance without invented PIDs or a URL', async () => {
  const terminal = await host();
  const message = await terminal.run();
  assert.match(message, /Configure the tunnel credentials, hostname, and Access application/);
  assert.doesNotMatch(message, /PID|Public URL/);
});

test('ready status renders a camera-openable pairing URL, its QR matrix, and validity', async () => {
  const terminal = await host({ status: ready });
  const message = await terminal.run();
  assert.match(message, /Single-use pairing link \(valid for 120 seconds\):/);
  assert.ok(message.includes(pairing.url));
  const rows = message.split('\n').filter((line) => /^[▀▄█ ]+$/.test(line));
  const qr = encode(pairing.url, { border: 4, ecc: 'M' });
  assert.equal(rows.length, Math.ceil(qr.size / 2));
  assert.ok(
    rows.every((row) => row.length === qr.size),
    'QR lines must retain their quiet zone.'
  );
  // Decode compact glyphs back into modules rather than comparing two renderer calls.
  const pixels = rows
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
    .slice(0, qr.size);
  assert.deepEqual(
    pixels,
    qr.data,
    'The QR must encode the URL itself, not JSON or a permanent password.'
  );
});

for (const dimensions of [{ width: 35 }, { height: 20 }]) {
  test(`uses link-only pairing when terminal space is insufficient: ${JSON.stringify(dimensions)}`, async () => {
    const terminal = await host({ status: ready, ...dimensions });
    const message = await terminal.run();
    assert.ok(message.includes(pairing.url));
    assert.match(message, /Not enough terminal space/);
    assert.doesNotMatch(message, /[▀▄█]/);
  });
}

test('an oversized pairing URL still offers a link instead of a broken QR', async () => {
  const url = `https://example.com/?code=${'x'.repeat(4000)}`;
  const terminal = await host({ status: ready, pairing: { url, expiresIn: 60 } });
  const message = await terminal.run();
  assert.ok(message.includes(url));
  assert.match(message, /QR code unavailable/);
});

test('a readiness race displays the new state without stale ready status or PIDs', async () => {
  const terminal = await host({
    status: ready,
    pairError: { type: 'not_ready', message: 'private detail', data: { state: 'restarting' } }
  });
  const message = await terminal.run();
  assert.match(message, /Status: restarting/);
  assert.match(message, /Run \/zero-trust again when it is ready/);
  assert.doesNotMatch(message, /Status: ready|private detail|PID|single-use-code/);
});

for (const error of [
  { type: 'unavailable', message: 'secret', data: {} },
  { type: 'not_ready', message: 'secret', data: { state: 'secret' } },
  new Error('secret'),
  null
]) {
  test('pairing failures use a fixed safe message', async () => {
    const terminal = await host({ status: ready, pairError: error });
    const message = await terminal.run();
    assert.match(message, /Pairing is unavailable/);
    assert.doesNotMatch(message, /secret|single-use-code|[▀▄█]/);
  });
}

test('status failures use a fixed safe message and never request pairing', async () => {
  const terminal = await host({ statusError: new Error('password=secret') });
  const message = await terminal.run();
  assert.match(message, /Status unavailable/);
  assert.doesNotMatch(message, /password|secret/);
  assert.equal(terminal.requests.length, 1);
});

for (const error of ZeroTrust.methods.status.output.shape.error.unwrap().options) {
  test(`shows a fixed diagnosis for ${error}`, async () => {
    const terminal = await host({ status: { state: 'error', error } });
    const message = await terminal.run();
    assert.equal(message.split('\n').length, 2);
    assert.match(message, /Status: error/);
    assert.doesNotMatch(message, /undefined|not implemented/);
    assert.equal(terminal.requests.length, 1);
  });
}
