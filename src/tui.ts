import { Plugin } from '@opencode/plugin/tui';
import { ZeroTrust } from './rpc.js';

export default Plugin.define({
  id: 'opencode-zero-trust.tui',
  setup(context) {
    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: 'opencode-zero-trust.status',
          title: 'Show Zero Trust status',
          group: 'Zero Trust',
          palette: true,
          slash: { name: 'zero-trust' },
          run: async () => {
            const location = context.location ?? context.data.location.default();
            const status = await context.client.rpc(ZeroTrust).status({}, { location });
            await context.ui.dialog.alert({
              title: 'OpenCode Zero Trust',
              message: [
                'The plugin scaffold is loaded. Cloudflare Tunnel is not implemented yet.',
                ...(status.hostname ? [`Configured hostname: ${status.hostname}`] : [])
              ].join('\n')
            });
          }
        }
      ]
    }));
  }
});
