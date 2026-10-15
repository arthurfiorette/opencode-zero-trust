import { Plugin } from '@opencode/plugin';
import { parseOptions } from './config.js';
import { ZeroTrust } from './rpc.js';

export default Plugin.define({
  id: 'opencode-zero-trust',
  async setup(context) {
    const options = parseOptions(context.options);

    await context.rpc.register(ZeroTrust, {
      status: async () => ({
        state: 'not-implemented' as const,
        ...(options.hostname ? { hostname: options.hostname } : {})
      })
    });
  }
});
