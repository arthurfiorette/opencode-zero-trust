import type { Plugin } from '@opencode/plugin/tui';
import { MouseButton, type MouseEvent } from '@opentui/core';
import { jsx } from '@opentui/solid/jsx-runtime';
import { createSignal, onCleanup } from 'solid-js';

export default function QrPanel(props: {
  context: Plugin.Context;
  qr: string;
  columns: number;
  expiresAt: number;
  url: string;
}) {
  const [expired, setExpired] = createSignal(Date.now() >= props.expiresAt);
  const [hovered, setHovered] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const copy = () => {
    if (expired() || Date.now() >= props.expiresAt) return;
    try {
      if (!props.context.renderer.copyToClipboardOSC52(props.url))
        throw new Error('Clipboard unavailable');
      setCopied(true);
    } catch {
      props.context.ui.toast.show({
        message: 'Terminal clipboard unavailable. Scan the QR code instead.',
        variant: 'error'
      });
    }
  };
  props.context.keymap.layer(() => ({
    commands: [
      {
        id: 'opencode-zero-trust.qr.copy',
        title: 'Copy pairing link',
        bind: 'c',
        enabled: () => !expired(),
        run: copy
      }
    ]
  }));
  const timer = setTimeout(() => setExpired(true), Math.max(0, props.expiresAt - Date.now()));
  onCleanup(() => clearTimeout(timer));
  return jsx('box', {
    padding: 1,
    alignItems: 'center',
    children: [
      jsx('text', {
        id: 'zero-trust-pairing-qr',
        wrapMode: 'none',
        width: props.columns,
        get fg() {
          return expired() ? props.context.theme.text.muted : props.context.theme.text.base;
        },
        get bg() {
          return props.context.theme.background.raised.base;
        },
        get children() {
          return expired() ? 'QR code expired. Open it again to pair.' : props.qr;
        }
      }),
      jsx('box', {
        id: 'zero-trust-copy-link',
        flexDirection: 'row',
        gap: 1,
        marginTop: 1,
        get visible() {
          return !expired();
        },
        onMouseOver: () => setHovered(true),
        onMouseOut: () => setHovered(false),
        onMouseUp: (event: MouseEvent) => {
          if (event.button !== MouseButton.LEFT) return;
          event.stopPropagation();
          copy();
        },
        children: [
          jsx('text', { fg: props.context.theme.text.base, children: '⧉' }),
          jsx('text', {
            get fg() {
              return hovered() ? props.context.theme.text.base : props.context.theme.text.muted;
            },
            get children() {
              return copied() ? 'Copied' : 'Copy link';
            }
          })
        ]
      })
    ]
  });
}
