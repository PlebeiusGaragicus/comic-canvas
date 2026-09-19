/** Install prompt capture (`beforeinstallprompt`) and dismissal memory. */
import { useEffect, useState } from 'react';
import { readSettings, writeSettings } from '../services/settings';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function installInstallPromptCapture(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Whether an install affordance should be shown, and the actions for it. */
export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<boolean>; dismiss: () => Promise<void> } {
  const [, force] = useState(0);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    readSettings()
      .then((settings) => setDismissed(Boolean(settings.uiPrefs.installDismissed)))
      .catch(() => setDismissed(false));
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return {
    canInstall: Boolean(deferredPrompt) && dismissed === false && !isStandalone(),
    install: async () => {
      if (!deferredPrompt) return false;
      const prompt = deferredPrompt;
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') deferredPrompt = null;
      notify();
      return outcome === 'accepted';
    },
    dismiss: async () => {
      setDismissed(true);
      const settings = await readSettings();
      await writeSettings({ uiPrefs: { ...settings.uiPrefs, installDismissed: true } });
    },
  };
}
