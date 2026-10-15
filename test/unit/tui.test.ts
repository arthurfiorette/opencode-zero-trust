import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Plugin } from '@opencode/plugin/tui';
import type { DialogAlertOptions, KeymapLayer } from '@opencode/plugin/tui/context';
import { ZeroTrust } from '../../src/rpc.js';
import plugin from '../../src/tui.js';

for (const explicit of [true, false]) {
  test(`registers /zero-trust and queries the ${explicit ? 'explicit' : 'default'} Location`, async () => {
    const layers: KeymapLayer[] = [];
    const dialogs: DialogAlertOptions[] = [];
    const requests: unknown[] = [];
    const location = { directory: '/workspace/project' };
    const context = {
      location: explicit ? location : undefined,
      data: {
        location: {
          default() {
            assert.equal(
              explicit,
              false,
              'Explicit Locations must not be replaced by the default.'
            );
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
            async status(input: unknown, options: unknown) {
              requests.push({ input, options });
              return {
                state: 'not-implemented',
                ...(explicit ? { hostname: 'opencode-mac.example.com' } : {})
              };
            }
          };
        }
      },
      ui: {
        dialog: {
          async alert(options: DialogAlertOptions) {
            dialogs.push(options);
          }
        }
      }
    };

    // Only the host APIs used by this plugin are simulated; RPC transport is covered by the SDK integration.
    await plugin.setup(context as unknown as Plugin.Context);
    const command = layers[0]?.commands?.find((item) => item.id === 'opencode-zero-trust.status');
    assert.ok(command);
    assert.equal(command.palette, true);
    assert.deepEqual(command.slash, { name: 'zero-trust' });
    assert.deepEqual(requests, [], 'Registration must not make requests or start a tunnel.');

    await command.run();
    assert.deepEqual(requests, [{ input: {}, options: { location } }]);
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0]?.message ?? '', /not implemented yet/);
    assert.equal(dialogs[0]?.message.includes('opencode-mac.example.com'), explicit);
  });
}
