'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { logEvent } from '@/lib/analytics';
import { logOnce } from '@/lib/log/dedupe';

interface NetworkStatusContextType {
  isOnline: boolean;
  networkState: 'online' | 'degraded' | 'offline';
  lastCheckedAt: number | null;
  checkNow: () => Promise<void>;
}

const NetworkStatusContext = createContext<NetworkStatusContextType | undefined>(undefined);

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  // Optimistic initial state based on navigator
  const [isOnline, setIsOnline] = useState(() =>
    typeof window !== 'undefined' ? window.navigator.onLine : true
  );
  const [networkState, setNetworkState] = useState<'online' | 'degraded' | 'offline'>(() =>
    typeof window !== 'undefined' && window.navigator.onLine === false ? 'offline' : 'online',
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  // Refs for tracking state without triggering re-renders in loops
  const failCount = useRef(0);
  const isChecking = useRef(false);
  const timerRef = useRef<number | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const stateRef = useRef<'online' | 'degraded' | 'offline'>('online');
  const onlineRef = useRef(true);
  const hiddenRef = useRef(false);

  // Configuration
  const MAX_FAILURES = 2;
  const POLL_INTERVAL = 15000;
  const DEGRADED_INTERVAL = 6000;
  const RETRY_DELAY = 2500;
  const HIDDEN_INTERVAL = 45000;

  const publishWindowState = useCallback((state: 'online' | 'degraded' | 'offline', online: boolean) => {
    if (typeof window === 'undefined') return;
    (window as any).__DCAU_NETWORK_STATE = {
      isOnline: online,
      state,
      lastCheckedAt: Date.now(),
    };
  }, []);

  const commitState = useCallback(
    (nextState: 'online' | 'degraded' | 'offline') => {
      const nextOnline = nextState !== 'offline';

      stateRef.current = nextState;
      onlineRef.current = nextOnline;

      setNetworkState((prev) => (prev === nextState ? prev : nextState));
      setIsOnline((prev) => (prev === nextOnline ? prev : nextOnline));
      publishWindowState(nextState, nextOnline);
    },
    [publishWindowState],
  );

  const scheduleNextCheck = useCallback((checkHealth: () => Promise<void>) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const delay = hiddenRef.current
      ? HIDDEN_INTERVAL
      : stateRef.current === 'offline'
        ? RETRY_DELAY
        : stateRef.current === 'degraded'
          ? DEGRADED_INTERVAL
          : POLL_INTERVAL;

    timerRef.current = window.setTimeout(() => {
      void checkHealth();
    }, delay);
  }, []);

  const checkHealth = useCallback(async () => {
    if (isChecking.current) return;

    // If navigator says offline, we are offline. No need to ping.
    if (!window.navigator.onLine) {
      failCount.current = MAX_FAILURES;
      commitState('offline');
      setLastCheckedAt(Date.now());
      scheduleNextCheck(checkHealth);
      return;
    }

    isChecking.current = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (res.ok) {
        // Success
        failCount.current = 0;
        lastErrorRef.current = null;
        if (stateRef.current !== 'online') {
          logEvent('network_health_restored', { ts: Date.now() });
        }
        commitState('online');
      } else {
        failCount.current++;
        lastErrorRef.current = `status_${res.status}`;
        commitState('degraded');
      }
    } catch (error) {
      failCount.current++;
      lastErrorRef.current = String((error as any)?.message || error);
      commitState('degraded');
    } finally {
      clearTimeout(timeoutId);
      isChecking.current = false;
      setLastCheckedAt(Date.now());

      if (stateRef.current === 'offline') {
        if (onlineRef.current === false) {
          logOnce('warn', 'network:health:offline', '[network] Health check failed', lastErrorRef.current);
          logEvent('network_health_offline', { error: lastErrorRef.current, failCount: failCount.current });
        }
      }
      scheduleNextCheck(checkHealth);
    }
  }, [MAX_FAILURES, commitState, scheduleNextCheck]);

  useEffect(() => {
    publishWindowState(networkState, isOnline);
  }, [isOnline, networkState, publishWindowState]);

  useEffect(() => {
    void checkHealth();

    const handleOnline = () => {
      failCount.current = 0;
      void checkHealth();
    };

    const handleOffline = () => {
      failCount.current = MAX_FAILURES;
      commitState('offline');
      setLastCheckedAt(Date.now());
      scheduleNextCheck(checkHealth);
    };

    const handleVisibility = () => {
      hiddenRef.current = document.visibilityState === 'hidden';
      if (!hiddenRef.current) {
        void checkHealth();
      } else {
        scheduleNextCheck(checkHealth);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkHealth, commitState, scheduleNextCheck]);

  return (
    <NetworkStatusContext.Provider value={{ isOnline, networkState, lastCheckedAt, checkNow: checkHealth }}>
      {children}

      {/* Global Offline Floating Indicator */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-[100] flex items-center gap-3 px-4 py-2.5 rounded-full bg-zinc-900/95 text-zinc-100 shadow-xl backdrop-blur-md border border-white/10"
          >
            <div className="bg-red-500/20 p-1.5 rounded-full">
              <WifiOff className="h-3.5 w-3.5 text-red-400" />
            </div>
            <span className="text-xs font-medium pr-1">You are offline</span>
          </motion.div>
        )}
      </AnimatePresence>
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus() {
  const context = useContext(NetworkStatusContext);
  if (context === undefined) {
    throw new Error('useNetworkStatus must be used within a NetworkStatusProvider');
  }
  return context;
}
