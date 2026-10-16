import type { Plugin } from '@opencode/plugin/tui';
import { createComponent, createMemo, lazy } from 'solid-js';

// Loading the package in a Node consumer must not load OpenTUI's native renderer.
const Sidebar = lazy(() => import('./sidebar-view.js'));

export interface SidebarActions {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  operation(): 'connect' | 'disconnect' | undefined;
}

export function installSidebar(context: Plugin.Context, actions?: SidebarActions): () => void {
  return context.ui.slot({
    append: 'sidebar.content',
    render: () => {
      const view = createComponent(Sidebar, { context, actions });
      return createMemo(() => {
        const node = typeof view === 'function' ? view() : view;
        // Solid lazy() returns an empty string while loading; OpenTUI boxes cannot contain text nodes.
        return node === '' ? undefined : node;
      });
    }
  });
}
