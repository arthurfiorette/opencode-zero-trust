import type { Plugin } from '@opencode/plugin/tui';
import { createComponent, createMemo, lazy } from 'solid-js';
import { renderUnicodeCompact } from 'uqr';
import type { Pairing } from './rpc.js';

const Panel = lazy(() => import('./qr-panel.js'));

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
  context.ui.dialog.show(() => {
    const view = createComponent(Panel, { context, qr, columns, expiresAt, url: pairing.url });
    return createMemo(() => {
      const node = typeof view === 'function' ? view() : view;
      return node === '' ? undefined : node;
    });
  });
  const size = columns + 2 <= 60 ? 'medium' : columns + 2 <= 88 ? 'large' : 'xlarge';
  context.ui.dialog.set({ size, centered: true });
}
