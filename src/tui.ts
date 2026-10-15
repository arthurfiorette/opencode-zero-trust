import { Plugin } from '@opencode/plugin/tui';
import { renderUnicodeCompact } from 'uqr';
import { type Status, ZeroTrust } from './rpc.js';

const diagnoses: Record<NonNullable<Status['error']>, string> = {
  'daemon-unavailable': 'The OpenCode daemon is unavailable. Check the running service.',
  'daemon-mismatch': 'The discovered service does not match this OpenCode daemon.',
  'daemon-auth-required': 'The OpenCode daemon requires authentication before pairing.',
  'daemon-not-loopback': 'The OpenCode daemon must listen on a loopback address.',
  'credentials-invalid': 'The tunnel credentials file is invalid or unreadable.',
  'credentials-permissions': 'Restrict access to the tunnel credentials file.',
  'node-unavailable': 'Node.js could not start. Check nodePath and the supported Node.js version.',
  'cloudflared-unavailable': 'cloudflared could not start. Check cloudflaredPath.',
  'cloudflared-exited': 'cloudflared stopped. Check the tunnel configuration and network.',
  'helper-unavailable': 'The tunnel helper is unavailable. Check the local runtime.',
  'helper-protocol-error': 'The tunnel helper returned an invalid response.',
  'configuration-conflict': 'Active Locations have conflicting tunnel configurations.'
};

function describe(status: Status): string[] {
  return [
    `Status: ${status.state}`,
    ...(status.state === 'unconfigured'
      ? [
          'Configure the tunnel credentials, hostname, and Access application to enable remote access.'
        ]
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
            let lines: string[];
            try {
              const location = context.location ?? context.data.location.default();
              const rpc = context.client.rpc(ZeroTrust);
              const status = await rpc.status({}, { location });
              lines = describe(status);
              if (status.state === 'ready') {
                try {
                  const pairing = await rpc.pair({}, { location });
                  lines.push(
                    '',
                    `Single-use pairing link (valid for ${pairing.expiresIn} seconds):`,
                    pairing.url
                  );
                  try {
                    const qr = renderUnicodeCompact(pairing.url, { border: 4, ecc: 'M' });
                    const rows = qr.split('\n');
                    // The host caps xlarge dialogs at 116 columns, with four columns of alert padding.
                    const available = Math.min(116, context.renderer.width - 2) - 4;
                    const textRows = lines.reduce(
                      (count, line) =>
                        count + Math.max(1, Math.ceil(line.length / Math.max(1, available))),
                      0
                    );
                    if (
                      rows[0]!.length <= available &&
                      rows.length + textRows + 10 <= context.renderer.height
                    ) {
                      lines.push('', qr);
                    } else {
                      lines.push(
                        '',
                        'Not enough terminal space for a QR code. Open the pairing link instead.'
                      );
                    }
                  } catch {
                    lines.push('', 'QR code unavailable. Open the pairing link instead.');
                  }
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
        }
      ]
    }));
  }
});
