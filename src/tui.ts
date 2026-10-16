import { Plugin } from '@opencode/plugin/tui';
import { createStore } from 'solid-js/store';
import { showQrDialog } from './qr-dialog.js';
import { type Status, ZeroTrust } from './rpc.js';
import { installSidebar } from './sidebar.js';

const diagnoses: Record<NonNullable<Status['error']>, string> = {
  'daemon-unavailable': 'The OpenCode daemon is unavailable. Check the running service.',
  'daemon-mismatch': 'The discovered service does not match this OpenCode daemon.',
  'daemon-auth-required': 'The OpenCode daemon requires authentication before pairing.',
  'daemon-not-loopback': 'The OpenCode daemon must listen on a loopback address.',
  'dns-check-failed':
    'Could not check the public hostname. Check DNS connectivity or manage DNS with autoDns: false.',
  'dns-route-failed':
    'Could not create the DNS route. Check cloudflared login and cert.pem, or configure DNS manually and set autoDns: false.',
  'credentials-invalid': 'The tunnel credentials file is invalid or unreadable.',
  'credentials-permissions': 'Restrict access to the tunnel credentials file.',
  'credentials-ambiguous':
    'Multiple tunnel credentials found in ~/.cloudflared. Set credentialsFile to choose one.',
  'node-unavailable': 'Node.js could not start. Check nodePath and the supported Node.js version.',
  'cloudflared-unavailable': 'cloudflared could not start. Check cloudflaredPath.',
  'cloudflared-exited': 'cloudflared stopped. Check the tunnel configuration and network.',
  'helper-unavailable': 'The tunnel helper is unavailable. Check the local runtime.',
  'helper-protocol-error': 'The tunnel helper returned an invalid response.',
  'configuration-conflict':
    'This daemon already owns a tunnel with different options. Use the same plugin options across projects, then run opencode service restart to apply configuration changes.'
};

function describe(status: Status): string[] {
  return [
    `Connector: ${status.state}`,
    ...(status.dns
      ? [
          `DNS: ${status.dns === 'created' ? 'route created; propagation not verified' : status.dns === 'resolved' ? 'hostname resolves; tunnel routing not verified' : 'not checked'}`
        ]
      : []),
    ...(status.state === 'unconfigured'
      ? ['Configure the tunnel credentials and hostname to enable remote access.']
      : []),
    ...(status.hostname ? [`Hostname: ${status.hostname}`] : []),
    ...(status.url ? [`Public URL: ${status.url}`] : []),
    ...(status.helperPid ? [`Helper PID: ${status.helperPid}`] : []),
    ...(status.connectorPid ? [`Connector PID: ${status.connectorPid}`] : []),
    ...(status.error ? [diagnoses[status.error]] : []),
    ...(status.state === 'error' && !status.error
      ? ['The tunnel is unavailable. Check its configuration and local runtime.']
      : [])
  ];
}

function pairingFailure(error: unknown, status: Status): string[] {
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'not_ready' &&
    'data' in error
  ) {
    const data = ZeroTrust.methods.pair.errors.not_ready.safeParse(error.data);
    if (data.success) {
      return [
        ...describe({
          state: data.data.state,
          ...(status.hostname ? { hostname: status.hostname } : {}),
          ...(status.url ? { url: status.url } : {})
        }),
        '',
        'The tunnel is not ready for pairing. Run /zero-trust again when it is ready.'
      ];
    }
  }
  return [...describe(status), '', 'Pairing is unavailable. Run /zero-trust again to retry.'];
}

export default Plugin.define({
  id: 'opencode-zero-trust.tui',
  setup(context) {
    const [activity, setActivity] = createStore<{
      operation: 'connect' | 'disconnect' | undefined;
    }>({ operation: undefined });
    const exclusive =
      (operation: 'connect' | 'disconnect', action: () => Promise<void>) => async () => {
        if (activity.operation) return;
        setActivity('operation', operation);
        try {
          await action();
        } finally {
          setActivity('operation', undefined);
        }
      };
    const disable = exclusive('disconnect', async () => {
      const confirmed = await context.ui.dialog.confirm({
        title: 'Disable Zero Trust tunnel?',
        message:
          'Remote connections to this daemon will be interrupted. Use Connect to start again. Credentials and Cloudflare resources will not be deleted.'
      });
      if (!confirmed) return;
      try {
        const location = context.location ?? context.data.location.default();
        const status = await context.client.rpc(ZeroTrust).disable({}, { location });
        const stopped = status.state === 'stopped' || status.state === 'unconfigured';
        context.ui.toast.show({
          title: 'OpenCode Zero Trust',
          message: !stopped
            ? 'Tunnel shutdown is not confirmed. Check the full status.'
            : status.state === 'unconfigured'
              ? 'No tunnel is configured.'
              : 'Tunnel disconnected.',
          variant: stopped ? 'info' : 'error'
        });
      } catch {
        context.ui.toast.show({
          title: 'OpenCode Zero Trust',
          message:
            'Could not confirm tunnel shutdown. Remove the plugin configuration and restart the OpenCode service.',
          variant: 'error'
        });
      }
    });
    const connect = exclusive('connect', async () => {
      try {
        const location = context.location ?? context.data.location.default();
        const status = await context.client.rpc(ZeroTrust).connect({}, { location });
        const failed = ['error', 'unconfigured', 'stopped'].includes(status.state);
        context.ui.toast.show({
          message: failed
            ? 'Tunnel is offline. Check /zero-trust status.'
            : status.state === 'ready'
              ? 'Tunnel online.'
              : 'Connecting tunnel...',
          variant: failed ? 'error' : 'info'
        });
      } catch {
        let message = 'Could not connect the tunnel. Check /zero-trust status.';
        try {
          const location = context.location ?? context.data.location.default();
          const status = await context.client.rpc(ZeroTrust).status({}, { location });
          if (status.error) message = diagnoses[status.error];
        } catch {
          // Do not expose transport errors or credentials in a toast.
        }
        context.ui.toast.show({
          message,
          variant: 'error'
        });
      }
    });
    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: 'opencode-zero-trust.status',
          title: 'Show Zero Trust status',
          group: 'Zero Trust',
          palette: true,
          slash: { name: 'zero-trust', arguments: true },
          run: async (input) => {
            const action = input?.trim().toLowerCase() ?? '';
            if (action === 'disable' || action === 'disconnect') return disable();
            if (action === 'connect') return connect();
            if (action && action !== 'status') {
              context.ui.toast.show({
                message: 'Usage: /zero-trust [status|connect|disconnect]',
                variant: 'error'
              });
              return;
            }
            let lines: string[];
            try {
              const location = context.location ?? context.data.location.default();
              const rpc = context.client.rpc(ZeroTrust);
              const status = await rpc.status({}, { location });
              lines = describe(status);
              if (status.state === 'ready' && action !== 'status') {
                try {
                  const started = Date.now();
                  const pairing = await rpc.pair({}, { location });
                  await showQrDialog(context, pairing, started);
                  return;
                } catch (error) {
                  // Readiness can change between the status and pairing requests.
                  lines = pairingFailure(error, status);
                }
              }
            } catch {
              lines = [
                'Status unavailable. Check that the Zero Trust server plugin is enabled for this Location.'
              ];
            }
            const closed = context.ui.dialog.alert({
              title: 'OpenCode Zero Trust',
              message: lines.join('\n')
            });
            // Opening an alert resets its presentation, so resize after it has opened.
            context.ui.dialog.set({ size: 'xlarge', centered: true });
            await closed;
          }
        },
        {
          id: 'opencode-zero-trust.disable',
          title: 'Disconnect Zero Trust tunnel',
          group: 'Zero Trust',
          palette: true,
          run: disable
        },
        {
          id: 'opencode-zero-trust.connect',
          title: 'Connect Zero Trust tunnel',
          group: 'Zero Trust',
          palette: true,
          run: connect
        },
        {
          id: 'opencode-zero-trust.details',
          title: 'Show Zero Trust connection details',
          group: 'Zero Trust',
          palette: true,
          run: () => {
            context.keymap.dispatch('opencode-zero-trust.status', 'status');
          }
        }
      ]
    }));
    return installSidebar(context, {
      connect,
      disconnect: disable,
      operation: () => activity.operation
    });
  }
});
