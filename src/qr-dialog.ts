import type { Plugin } from '@opencode/plugin/tui';
import { createComponent, ErrorBoundary } from 'solid-js';
import { renderUnicodeCompact } from 'uqr';
import type { Pairing } from './rpc.js';

async function copyPairingLink(
  context: Plugin.Context,
  pairing: Pairing,
  expiresAt: number
): Promise<void> {
  try {
    const action = await context.ui.dialog.select({
      title: 'QR code unavailable',
      options: [{ title: 'Copy pairing link', value: 'copy' }]
    });
    if (action !== 'copy') return;
    if (Date.now() >= expiresAt) {
      context.ui.toast.show({
        message: 'Pairing link expired. Run /zero-trust again.',
        variant: 'error'
      });
      return;
    }
    if (!context.renderer.copyToClipboardOSC52(pairing.url))
      throw new Error('Clipboard unavailable');
    context.ui.toast.show({ message: 'Pairing link copied.', variant: 'success' });
  } catch {
    context.ui.toast.show({
      message:
        'Could not copy the pairing link. Use opencode pair --url with your public hostname.',
      variant: 'error'
    });
  }
}

export async function showQrDialog(
  context: Plugin.Context,
  pairing: Pairing,
  started: number
): Promise<void> {
  let qr: string;
  try {
    qr = renderUnicodeCompact(pairing.url, { border: 4, ecc: 'M' });
  } catch {
    await context.ui.dialog.alert({
      title: 'Scan QR code',
      message: 'Could not generate the QR code. Try again.'
    });
    return;
  }
  const rows = qr.split('\n');
  const columns = Math.max(...rows.map((row) => row.length));
  if (
    columns > Math.min(116, context.renderer.width - 2) - 2 ||
    rows.length > context.renderer.height - 8
  ) {
    await context.ui.dialog.alert({
      title: 'Scan QR code',
      message: 'Enlarge the terminal to display the QR code.'
    });
    return;
  }
  const expiresAt = started + Math.min(300, pairing.expiresIn) * 1000;
  // Resolve the renderer module before mounting so import failures stay in this request.
  let Panel: typeof import('./qr-panel.js').default;
  try {
    Panel = (await import('./qr-panel.js')).default;
  } catch {
    await copyPairingLink(context, pairing, expiresAt);
    return;
  }
  context.ui.dialog.show(() => {
    return createComponent(ErrorBoundary, {
      fallback: () => {
        // Replacing the host dialog while Solid is unwinding can dispose the wrong owner.
        queueMicrotask(() => {
          context.ui.dialog.clear();
          void copyPairingLink(context, pairing, expiresAt);
        });
        return undefined;
      },
      get children() {
        return createComponent(Panel, { context, qr, columns, expiresAt, url: pairing.url });
      }
    });
  });
  const size = columns + 2 <= 60 ? 'medium' : columns + 2 <= 88 ? 'large' : 'xlarge';
  context.ui.dialog.set({ size, centered: true });
}
