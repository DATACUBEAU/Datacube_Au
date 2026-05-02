'use client';

/**
 * Sync Status Indicator
 *
 * Floating UI component that shows the offline write queue status:
 *   - Pending write count badge
 *   - Sync progress animation
 *   - Expandable panel with queued operations
 *   - Error state with retry button
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CloudOff, RefreshCw, Check, AlertTriangle, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { useOfflineWrites } from '@/hooks/use-offline-writes';
import { cn } from '@/lib/utils';

export function SyncStatusIndicator() {
  const {
    pendingCount,
    failedCount,
    totalCount,
    isSyncing,
    lastSyncedAt,
    queuedWrites,
    retryFailed,
    discard,
    triggerSync,
  } = useOfflineWrites();

  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render if there's nothing to show
  if (totalCount === 0 && !isSyncing) return null;

  const hasErrors = failedCount > 0;
  const allSynced = totalCount === 0 && !isSyncing;

  return (
    <AnimatePresence>
      {!allSynced && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={cn(
            'fixed bottom-20 right-4 z-[99] w-72 rounded-xl shadow-2xl border backdrop-blur-xl',
            hasErrors
              ? 'bg-red-950/90 border-red-500/30'
              : isSyncing
                ? 'bg-blue-950/90 border-blue-500/30'
                : 'bg-zinc-900/95 border-white/10',
          )}
        >
          {/* Header */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              {/* Icon */}
              <div
                className={cn(
                  'p-1.5 rounded-full',
                  hasErrors
                    ? 'bg-red-500/20'
                    : isSyncing
                      ? 'bg-blue-500/20'
                      : 'bg-amber-500/20',
                )}
              >
                {isSyncing ? (
                  <RefreshCw className="h-3.5 w-3.5 text-blue-400 animate-spin" />
                ) : hasErrors ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <CloudOff className="h-3.5 w-3.5 text-amber-400" />
                )}
              </div>

              {/* Text */}
              <div className="text-left">
                <p className="text-xs font-medium text-white">
                  {isSyncing
                    ? 'Syncing...'
                    : hasErrors
                      ? `${failedCount} sync error${failedCount > 1 ? 's' : ''}`
                      : `${pendingCount} pending`}
                </p>
                {lastSyncedAt && (
                  <p className="text-[10px] text-white/50">
                    Last sync: {new Date(lastSyncedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Badge */}
              {totalCount > 0 && (
                <span
                  className={cn(
                    'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
                    hasErrors
                      ? 'bg-red-500 text-white'
                      : 'bg-amber-500 text-black',
                  )}
                >
                  {totalCount > 9 ? '9+' : totalCount}
                </span>
              )}
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-white/50" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5 text-white/50" />
              )}
            </div>
          </button>

          {/* Expandable panel */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3 space-y-2 border-t border-white/5 pt-2">
                  {/* Queue items */}
                  <div className="max-h-40 overflow-y-auto space-y-1.5">
                    {queuedWrites.slice(0, 10).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-white/5"
                      >
                        <div className="flex items-center gap-2 truncate flex-1">
                          <span
                            className={cn(
                              'w-1.5 h-1.5 rounded-full flex-shrink-0',
                              item.status === 'pending' && 'bg-amber-400',
                              item.status === 'syncing' && 'bg-blue-400 animate-pulse',
                              item.status === 'failed' && 'bg-red-400',
                            )}
                          />
                          <span className="text-white/70 truncate">{item.label}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void discard(item.id);
                          }}
                          className="text-white/30 hover:text-white/60 flex-shrink-0 ml-2 p-0.5"
                          title="Discard"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {queuedWrites.length > 10 && (
                      <p className="text-[10px] text-white/40 text-center py-1">
                        +{queuedWrites.length - 10} more
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {hasErrors && (
                      <button
                        onClick={() => void retryFailed()}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry failed
                      </button>
                    )}
                    {pendingCount > 0 && !isSyncing && (
                      <button
                        onClick={() => void triggerSync()}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Sync now
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
