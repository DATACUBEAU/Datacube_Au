'use client';
import { useState, useEffect } from 'react';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof window !== 'undefined' ? window.navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    let timer: any = null;
    let pollTimer: any = null;
    let lastPollOk: boolean | null = null;
    let lastCommitted: boolean | null = null;

    const commit = (next: boolean, debounceMs: number) => {
      if (cancelled) return;
      if (lastCommitted === next) return;
      if (timer) clearTimeout(timer);
      if (debounceMs <= 0) {
        lastCommitted = next;
        setIsOnline(next);
        return;
      }
      timer = setTimeout(() => {
        if (cancelled) return;
        lastCommitted = next;
        setIsOnline(next);
      }, debounceMs);
    };

    const poll = async () => {
      if (cancelled) return;
      if (!window.navigator.onLine) {
        lastPollOk = false;
        commit(false, 0);
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      try {
        const res = await fetch('/api/health', { method: 'GET', cache: 'no-store', signal: controller.signal });
        lastPollOk = !!res.ok;
      } catch {
        lastPollOk = false;
      } finally {
        clearTimeout(timeoutId);
      }

      const next = window.navigator.onLine && (lastPollOk ?? false);
      commit(next, 250);
    };

    const handleOnline = () => {
      if (cancelled) return;
      poll();
    };
    const handleOffline = () => {
      if (cancelled) return;
      lastPollOk = false;
      commit(false, 0);
    };
    const handleVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') poll();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    poll();
    pollTimer = setInterval(poll, 15000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return isOnline;
}
