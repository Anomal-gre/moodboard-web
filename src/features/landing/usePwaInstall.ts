import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

/**
 * Call once from main.tsx so `beforeinstallprompt` is captured even before
 * the lazy-loaded LandingPage chunk mounts.
 */
export function initPwaInstallListener(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    notifyListeners();
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      const swUrl = `${import.meta.env.BASE_URL || './'}sw.js`;
      navigator.serviceWorker.register(swUrl).catch(() => undefined);
    });
  }
}

export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export type PwaInstallStatus = 'idle' | 'installed' | 'manual-hint';

export function usePwaInstall() {
  const [canPrompt, setCanPrompt] = useState(() => Boolean(deferredInstallPrompt));
  const [isStandalone, setIsStandalone] = useState(() => isRunningStandalone());
  const [status, setStatus] = useState<PwaInstallStatus>(() =>
    isRunningStandalone() ? 'installed' : 'idle'
  );

  useEffect(() => {
    const sync = () => {
      setCanPrompt(Boolean(deferredInstallPrompt));
      const standalone = isRunningStandalone();
      setIsStandalone(standalone);
      if (standalone) setStatus('installed');
    };
    listeners.add(sync);
    sync();

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onModeChange = () => sync();
    mql?.addEventListener?.('change', onModeChange);

    return () => {
      listeners.delete(sync);
      mql?.removeEventListener?.('change', onModeChange);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    if (isRunningStandalone()) {
      setStatus('installed');
      return;
    }
    if (!deferredInstallPrompt) {
      setStatus('manual-hint');
      return;
    }
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    setCanPrompt(false);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setStatus('installed');
      } else {
        setStatus('idle');
      }
    } catch {
      setStatus('manual-hint');
    }
    notifyListeners();
  }, []);

  return { canPrompt, isStandalone, status, triggerInstall };
}
