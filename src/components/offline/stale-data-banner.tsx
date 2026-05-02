'use client';

/**
 * Stale Data Banner
 *
 * A subtle, dismissible banner that indicates when the user is viewing
 * cached/stale data instead of live server data.
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, X, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

interface StaleDataBannerProps {
  /** Whether the data being shown is from cache */
  isUsingCachedData: boolean;
  /** Unix-ms timestamp of when the data was cached */
  cachedAt?: number | null;
  /** Custom message override */
  message?: string;
  /** Additional class names */
  className?: string;
}

function formatTimeSince(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function StaleDataBanner({
  isUsingCachedData,
  cachedAt,
  message,
  className,
}: StaleDataBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const { isOnline, networkState } = useNetworkStatus();

  if (!isUsingCachedData || dismissed) return null;

  const isOffline = !isOnline;
  const isDegraded = networkState === 'degraded';
  const timeLabel = cachedAt ? formatTimeSince(cachedAt) : null;

  const defaultMessage = isOffline
    ? 'Offline — showing cached data'
    : isDegraded
      ? 'Connection unstable — showing cached data'
      : timeLabel
        ? `Last updated ${timeLabel}`
        : 'Showing cached data';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className={cn(
          'relative overflow-hidden',
          className,
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] rounded-md',
            isOffline
              ? 'bg-amber-500/10 text-amber-400/90 border border-amber-500/20'
              : 'bg-muted/50 text-muted-foreground border border-border/50',
          )}
        >
          <div className="flex items-center gap-2">
            {isOffline ? (
              <WifiOff className="h-3 w-3 flex-shrink-0" />
            ) : (
              <Clock className="h-3 w-3 flex-shrink-0" />
            )}
            <span>{message || defaultMessage}</span>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-current opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
