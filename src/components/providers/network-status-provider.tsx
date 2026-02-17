'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface NetworkStatusContextType {
  isOnline: boolean;
  lastCheckedAt: number | null;
  checkNow: () => Promise<void>;
}

const NetworkStatusContext = createContext<NetworkStatusContextType | undefined>(undefined);

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  // Optimistic initial state based on navigator
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
