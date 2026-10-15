import { Plugin } from '@opencode/plugin';
import { parseOptions } from './config.js';
import { ConfigurationConflict, getManager } from './manager.js';
import type { Pairing, Status } from './rpc.js';
import { ZeroTrust } from './rpc.js';

export default Plugin.define({
  id: 'opencode-zero-trust',
  async setup(context) {
    const options = parseOptions(context.options);

    const manager = (() => {
      if (!options) return undefined;
      try {
        return getManager(options);
      } catch (error) {
        if (error instanceof ConfigurationConflict) return 'conflict' as const;
        throw error;
      }
    })();
    const status = (): Status => {
      if (manager === 'conflict') return { state: 'error', error: 'configuration-conflict' };
      return manager?.status() ?? { state: 'unconfigured' };
    };

    await context.rpc.register(ZeroTrust, {
      status: async () => status(),
      pair: async (_input, invocation) => {
        if (!manager || manager === 'conflict' || status().state !== 'ready') {
          return invocation.error('not_ready', 'The tunnel is not ready.', {
            state: status().state
          });
        }
        const pairing: Pairing | undefined = await manager.pair().catch(() => undefined);
        if (!pairing) return invocation.error('unavailable', 'Could not issue a pairing link.', {});
        return pairing;
      }
    });
  }
});
