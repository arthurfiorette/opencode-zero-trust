import type { Plugin } from '@opencode/plugin/tui';
import { type BoxRenderable, MouseButton, type MouseEvent, TextAttributes } from '@opentui/core';
import { jsx } from '@opentui/solid/jsx-runtime';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { ZeroTrust } from './rpc.js';
import type { SidebarActions } from './sidebar.js';
import { createSidebarState, type SidebarState } from './sidebar-state.js';

export default function Sidebar(props: {
  context: Plugin.Context;
  actions?: SidebarActions | undefined;
}) {
  const context = props.context;
  const [state, setState] = createStore<SidebarState>({ expanded: false });
  const [width, setWidth] = createSignal(0);
  const [pending, setPending] = createSignal<'connect' | 'disconnect'>();
  const operation = createMemo(() => pending() ?? props.actions?.operation());
  const transitioning = createMemo(
    () =>
      !!operation() ||
      ['starting', 'connecting', 'restarting', 'stopping'].includes(state.status?.state ?? '')
  );
  let box: BoxRenderable | undefined;
  const location = context.location ?? context.data.location.default();
  const rpc = context.client.rpc(ZeroTrust);
  const controller = createSidebarState({ status: () => rpc.status({}, { location }) }, (next) =>
    setState(reconcile(next))
  );
  const ready = createMemo(() => state.status?.state === 'ready');
  const hostname = createMemo(() => {
    if (state.status?.hostname) return state.status.hostname;
    try {
      return state.status?.url ? new URL(state.status.url).hostname : '';
    } catch {
      return '';
    }
  });
  const hostnameLabel = createMemo(() => {
    const columns = Math.max(0, Math.floor(width()) - 2);
    const value = hostname();
    if (value.length <= columns) return value;
    return columns <= 3 ? '.'.repeat(columns) : `${value.slice(0, columns - 3)}...`;
  });
  const connectable = createMemo(() => !!state.status && !ready());
  const transition = async (name: 'connect' | 'disconnect') => {
    if (transitioning()) return;
    setPending(name);
    try {
      if (props.actions) await props.actions[name]();
      else
        context.keymap.dispatch(
          name === 'connect' ? 'opencode-zero-trust.connect' : 'opencode-zero-trust.disable'
        );
      await controller.refresh();
    } finally {
      setPending(undefined);
    }
  };
  let polling: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void controller.refresh();
    polling = setInterval(() => void controller.refresh(), 5000);
  });
  onCleanup(() => {
    clearInterval(polling);
    controller.dispose();
  });

  context.keymap.layer(() => ({
    mode: 'global',
    commands: [
      {
        id: 'opencode-zero-trust.sidebar.toggle',
        title: 'Toggle Zero Trust sidebar',
        group: 'Zero Trust',
        palette: true,
        run: () => controller.toggle()
      }
    ]
  }));

  const text = (children: string | (() => string), muted = false) =>
    jsx('text', {
      get fg() {
        return muted ? context.theme.text.muted : context.theme.text.base;
      },
      get children() {
        return typeof children === 'function' ? children() : children;
      }
    });
  const action = (
    name: string,
    icon: string,
    label: string,
    command: string,
    visible = () => true
  ) => {
    const [hovered, setHovered] = createSignal(false);
    const id = `zero-trust-sidebar-${name}`;
    return jsx('box', {
      id,
      flexDirection: 'row',
      gap: 1,
      get visible() {
        return visible();
      },
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
      onMouseUp: (event: MouseEvent) => {
        if (event.button !== MouseButton.LEFT || transitioning()) return;
        event.stopPropagation();
        if (name === 'connect' || name === 'disconnect') void transition(name);
        else context.keymap.dispatch(command);
      },
      children: [
        jsx('text', {
          id: `${id}-icon`,
          get fg() {
            return transitioning() ? context.theme.text.muted : context.theme.text.base;
          },
          children: icon
        }),
        jsx('text', {
          id: `${id}-label`,
          get fg() {
            return hovered() && !transitioning()
              ? context.theme.text.base
              : context.theme.text.muted;
          },
          children: label
        })
      ]
    });
  };

  // Construct renderables once. Polling updates properties, never the action tree.
  return jsx('box', {
    flexShrink: 0,
    ref: (value: BoxRenderable) => {
      box = value;
      setWidth(value.width);
    },
    onSizeChange: () => setWidth(box?.width ?? 0),
    children: [
      jsx('box', {
        id: 'zero-trust-sidebar-header',
        flexDirection: 'row',
        gap: 1,
        onMouseUp: (event: MouseEvent) => {
          if (event.button !== MouseButton.LEFT) return;
          event.stopPropagation();
          controller.toggle();
        },
        children: [
          text(() => (state.expanded ? '▼' : '▶'), true),
          jsx('text', {
            attributes: TextAttributes.BOLD,
            get fg() {
              return context.theme.text.base;
            },
            children: 'Zero Trust'
          })
        ]
      }),
      jsx('box', {
        get visible() {
          return state.expanded;
        },
        children: [
          jsx('box', {
            flexDirection: 'row',
            gap: 1,
            height: 1,
            marginBottom: 1,
            children: [
              jsx('text', {
                id: 'zero-trust-sidebar-status',
                get fg() {
                  if (transitioning()) return context.theme.text.feedback.warning.base;
                  if (state.status?.state === 'error' || state.message)
                    return context.theme.text.feedback.error.base;
                  return ready() && !transitioning()
                    ? context.theme.text.feedback.success.base
                    : context.theme.text.muted;
                },
                children: '•'
              }),
              jsx('text', {
                id: 'zero-trust-sidebar-hostname',
                wrapMode: 'none',
                height: 1,
                get width() {
                  return Math.max(0, Math.floor(width()) - 2);
                },
                get visible() {
                  return !!hostname();
                },
                get fg() {
                  return context.theme.text.muted;
                },
                get children() {
                  return hostnameLabel();
                }
              })
            ]
          }),
          action('scan', '▦', 'Scan QR code', 'opencode-zero-trust.status', ready),
          action('connect', '↗', 'Connect', 'opencode-zero-trust.connect', connectable),
          action('details', '≡', 'Details', 'opencode-zero-trust.details'),
          action(
            'disconnect',
            '⏻',
            'Disconnect',
            'opencode-zero-trust.disable',
            () => !!state.status && !['unconfigured', 'stopped'].includes(state.status.state)
          )
        ]
      })
    ]
  });
}
