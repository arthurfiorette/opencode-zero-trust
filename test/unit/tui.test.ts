import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Plugin } from '@opencode/plugin/tui';
import type {
  DialogAlertOptions,
  DialogOptions,
  KeymapLayer,
  ToastOptions
} from '@opencode/plugin/tui/context';
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
    confirmed?: boolean;
    disableError?: unknown;
    connectError?: unknown;
  } = {}
) {
  const layers: KeymapLayer[] = [];
  const dialogs: DialogAlertOptions[] = [];
  const sizes: DialogOptions[] = [];
  const requests: unknown[] = [];
  const toasts: ToastOptions[] = [];
  let qrPanels = 0;
  let confirmations = 0;
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
          },
          async disable(input: unknown, callOptions: unknown) {
            requests.push({ method: 'disable', input, options: callOptions });
            if ('disableError' in options) throw options.disableError;
            return { state: 'stopped' };
          },
          async connect(input: unknown, callOptions: unknown) {
            requests.push({ method: 'connect', input, options: callOptions });
            if ('connectError' in options) throw options.connectError;
            return { state: 'starting' };
          }
        };
      }
    },
    ui: {
      toast: {
        show(value: ToastOptions) {
          toasts.push(value);
        }
      },
      slot() {
        return () => {};
      },
      dialog: {
        show() {
          qrPanels++;
        },
        async confirm() {
          confirmations++;
          return options.confirmed ?? true;
        },
        async alert(value: DialogAlertOptions) {
          dialogs.push(value);
          sizes.length = 0;
        },
        set(value: DialogOptions) {
          assert.equal(dialogs.length + qrPanels, 1, 'Size must be set after opening the dialog.');
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
    toasts,
    qrPanels: () => qrPanels,
    confirmations: () => confirmations,
    async run() {
      await command.run();
      assert.equal(dialogs.length, 1);
      return dialogs[0]!.message;
    }
  };
}

for (const explicit of [true, false]) {
  test(`registers /zero-trust and uses the ${explicit ? 'explicit' : 'default'} Location`, async () => {
    const terminal = await host({ explicit, status: ready });
    assert.equal(terminal.command.palette, true);
    assert.equal(terminal.command.title, 'Show Zero Trust status');
    assert.deepEqual(terminal.command.slash, { name: 'zero-trust', arguments: true });
    await terminal.command.run();
    assert.equal(terminal.qrPanels(), 1);
    assert.deepEqual(terminal.requests, [
      { method: 'status', input: {}, options: { location } },
      { method: 'pair', input: {}, options: { location } }
    ]);
  });
}

test('/zero-trust disable confirms and stops without issuing pairing', async () => {
  const terminal = await host({ explicit: true, status: ready });
  await terminal.command.run('disable');
  assert.equal(terminal.confirmations(), 1);
  assert.deepEqual(terminal.requests, [{ method: 'disable', input: {}, options: { location } }]);
  assert.match(terminal.toasts[0]?.message ?? '', /disconnected/);
});

test('/zero-trust status displays diagnostics without issuing pairing', async () => {
  const terminal = await host({ status: ready });
  await terminal.command.run('status');
  assert.equal(terminal.requests.length, 1);
  assert.match(terminal.dialogs[0]?.message ?? '', /Connector: ready/);
  assert.deepEqual(terminal.sizes, [{ size: 'xlarge', centered: true }]);
  assert.ok(!JSON.stringify(terminal.dialogs).includes('single-use-code'));
});

test('/zero-trust connect starts explicitly without requesting pairing', async () => {
  const terminal = await host({ explicit: true });
  await terminal.command.run('connect');
  assert.deepEqual(terminal.requests, [{ method: 'connect', input: {}, options: { location } }]);
  assert.match(terminal.toasts[0]?.message ?? '', /Connecting/);
});

test('connect reports configuration conflicts directly instead of looping back to status', async () => {
  const terminal = await host({
    status: { state: 'error', error: 'configuration-conflict' },
    connectError: { type: 'unavailable', message: 'private transport detail' }
  });
  await terminal.command.run('connect');
  assert.equal(terminal.toasts[0]?.variant, 'error');
  assert.match(terminal.toasts[0]?.message ?? '', /different options/);
  assert.match(terminal.toasts[0]?.message ?? '', /opencode service restart/);
  assert.ok(!JSON.stringify(terminal.toasts).includes('private transport detail'));
});

test('cancelled disable leaves the connector untouched', async () => {
  const terminal = await host({ confirmed: false });
  await terminal.command.run('disable');
  assert.deepEqual(terminal.requests, []);
  assert.equal(terminal.toasts.length, 0);
});

test('disable failures do not claim shutdown or expose raw errors', async () => {
  const terminal = await host({ disableError: new Error('private-token') });
  await terminal.command.run('disable');
  assert.equal(terminal.toasts[0]?.variant, 'error');
  assert.match(terminal.toasts[0]?.message ?? '', /Could not confirm/);
  assert.ok(!JSON.stringify(terminal.toasts).includes('private-token'));
});

for (const state of [
  'unconfigured',
  'starting',
  'connecting',
  'restarting',
  'stopping',
  'stopped',
  'error'
] as const) {
  test(`shows ${state} without requesting a pairing code`, async () => {
    const terminal = await host({ status: { ...ready, state } });
    const message = await terminal.run();
    assert.match(message, new RegExp(`Connector: ${state}`));
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
  assert.match(message, /Configure the tunnel credentials and hostname/);
  assert.doesNotMatch(message, /PID|Public URL/);
});

test('ready command opens only a QR panel without diagnostic or URL text', async () => {
  const terminal = await host({ status: ready });
  await terminal.command.run();
  assert.equal(terminal.qrPanels(), 1);
  assert.deepEqual(terminal.dialogs, []);
  assert.deepEqual(terminal.sizes, [{ size: 'medium', centered: true }]);
});

for (const dimensions of [{ width: 35 }, { height: 20 }]) {
  test(`asks for more space rather than clipping QR: ${JSON.stringify(dimensions)}`, async () => {
    const terminal = await host({ status: ready, ...dimensions });
    const message = await terminal.run();
    assert.ok(!message.includes(pairing.url));
    assert.match(message, /Enlarge the terminal/);
    assert.doesNotMatch(message, /[▀▄█]/);
  });
}

test('an oversized pairing URL reports a safe rendering error', async () => {
  const url = `https://example.com/?code=${'x'.repeat(4000)}`;
  const terminal = await host({ status: ready, pairing: { url, expiresIn: 60 } });
  const message = await terminal.run();
  assert.ok(!message.includes(url));
  assert.match(message, /Could not generate/);
});

test('a readiness race displays the new state without stale ready status or PIDs', async () => {
  const terminal = await host({
    status: ready,
    pairError: { type: 'not_ready', message: 'private detail', data: { state: 'restarting' } }
  });
  const message = await terminal.run();
  assert.match(message, /Connector: restarting/);
  assert.match(message, /Run \/zero-trust again when it is ready/);
  assert.doesNotMatch(message, /Connector: ready|private detail|PID|single-use-code/);
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
    assert.match(message, /Connector: error/);
    assert.doesNotMatch(message, /undefined|not implemented/);
    assert.equal(terminal.requests.length, 1);
  });
}
