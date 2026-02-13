'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';

interface NetworkStatusContextType {
  isOnline: boolean;
  lastCheckedAt: number | null;
  checkNow: () => Promise<void>;
}

const NetworkStatusContext = createContext<NetworkStatusContextType | undefined>(undefined);

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  // optimistic initial state based on navigator
  const [isOnline, setIsOnline] = useState(() => 
    typeof window !== 'undefined' ? window.navigator.onLine : true
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  
  // Refs for tracking state without triggering re-renders in loops
  const failCount = useRef(0);
  const isChecking = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Configuration
  const MAX_FAILURES = 2; // Flip to offline after 2 failures
  const POLL_INTERVAL = 15000; // 15s normal polling
  const RETRY_DELAY = 2000; // 2s retry when failing

  const checkHealth = useCallback(async () => {
    if (isChecking.current) return;
    
    // If navigator says offline, we are offline. No need to ping.
    if (!window.navigator.onLine) {
      if (isOnline) setIsOnline(false);
      failCount.current = MAX_FAILURES; // Force fail state
      setLastCheckedAt(Date.now());
      return;
    }

    isChecking.current = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const res = await fetch('/api/health', { 
        method: 'GET', 
        cache: 'no-store', 
        signal: controller.signal 
      });

      if (res.ok) {
        // Success
        failCount.current = 0;
        if (!isOnline) setIsOnline(true);
      } else {
        // HTTP Error (500, etc) - treat as potential connectivity issue
        failCount.current++;
      }
    } catch (error) {
      // Network Error (fetch failed)
      failCount.current++;
    } finally {
      clearTimeout(timeoutId);
      isChecking.current = false;
      setLastCheckedAt(Date.now());
      
      // Decision Logic
      if (failCount.current >= MAX_FAILURES) {
        if (isOnline) setIsOnline(false);
      }
    }
  }, [isOnline]);

  // Polling Logic with Backoff
  useEffect(() => {
    const scheduleNext = () => {
      const delay = failCount.current > 0 && failCount.current < MAX_FAILURES 
        ? RETRY_DELAY 
        : POLL_INTERVAL;
      
      timerRef.current = setTimeout(async () => {
        await checkHealth();
        scheduleNext();
      }, delay);
    };

    // Initial check
    checkHealth();
    scheduleNext();

    const handleOnline = () => {
        failCount.current = 0;
        checkHealth();
    };
    
    const handleOffline = () => {
        setIsOnline(false);
        failCount.current = MAX_FAILURES;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkHealth]);

  return (
    <NetworkStatusContext.Provider value={{ isOnline, lastCheckedAt, checkNow: checkHealth }}>
      {children}
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
