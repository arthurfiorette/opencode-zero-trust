import type { Status } from './rpc.js';

export interface SidebarState {
  expanded: boolean;
  status?: Status | undefined;
  message?: string | undefined;
}

export function createSidebarState(
  rpc: { status(): Promise<Status> },
  changed: (state: SidebarState) => void
) {
  let state: SidebarState = { expanded: false };
  let disposed = false;
  let pending = false;

  function publish(update: Partial<SidebarState>) {
    if (disposed) return;
    if (
      Object.entries(update).every(([key, value]) => state[key as keyof SidebarState] === value)
    ) {
      return;
    }
    state = { ...state, ...update };
    changed(state);
  }

  async function refresh(): Promise<void> {
    if (disposed || pending) return;
    pending = true;
    try {
      const status = await rpc.status();
      if (disposed) return;
      const unchanged = Object.keys({ ...state.status, ...status }).every(
        (key) => status[key as keyof Status] === state.status?.[key as keyof Status]
      );
      publish({ status: unchanged ? state.status : status, message: undefined });
    } catch {
      publish({ status: undefined, message: 'Status unavailable. Check the server plugin.' });
    } finally {
      pending = false;
    }
  }

  return {
    snapshot: () => state,
    refresh,
    toggle() {
      publish({ expanded: !state.expanded });
    },
    dispose() {
      disposed = true;
      state = { expanded: false };
    }
  };
}
