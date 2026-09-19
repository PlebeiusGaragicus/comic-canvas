/** Cross-tab change notifications. Services call `notifyChange` after writes;
 *  the UI refetches when another tab touched the open project. */

export interface StoreChange {
  store: string;
  slug: string | null;
}

type Listener = (change: StoreChange) => void;

const CHANNEL_NAME = 'comic-canvas-changes';
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<StoreChange>) => {
    for (const listener of listeners) listener(event.data);
  };
  return channel;
}

export function notifyChange(store: string, slug: string | null): void {
  ensureChannel()?.postMessage({ store, slug } satisfies StoreChange);
}

/** Listen for changes made in *other* tabs. Returns an unsubscribe function. */
export function onRemoteChange(listener: Listener): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
