/** Service-worker registration and the "update available" flow (workbox-window). */
import { registerSW } from 'virtual:pwa-register';

export interface UpdateController {
  /** Resolves when a new version is waiting; call `reload` to activate it. */
  onUpdateAvailable: (listener: (reload: () => void) => void) => () => void;
  onOfflineReady: (listener: () => void) => () => void;
}

const updateListeners = new Set<(reload: () => void) => void>();
const readyListeners = new Set<() => void>();
let reloadFn: (() => void) | null = null;

export function registerServiceWorker(): UpdateController {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        reloadFn = () => void update(true);
        for (const listener of updateListeners) listener(reloadFn);
      },
      onOfflineReady() {
        for (const listener of readyListeners) listener();
      },
      onRegisterError(error) {
        console.error('[comic-canvas] service worker registration failed', error);
      },
    });
  }
  return {
    onUpdateAvailable: (listener) => {
      updateListeners.add(listener);
      if (reloadFn) listener(reloadFn);
      return () => updateListeners.delete(listener);
    },
    onOfflineReady: (listener) => {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
  };
}
