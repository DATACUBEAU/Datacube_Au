'use client';

/**
 * React hook for offline write queue status and sync engine integration.
 *
 * Provides reactive access to:
 *   - Number of pending/failed writes
 *   - Sync status (syncing, last sync timestamp)
 *   - Manual retry/discard actions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getPendingCount,
  getFailedCount,
  getQueuedWrites,
  retryAllFailed,
  discardWrite,
  onQueueUpdate,
  type QueuedWrite,
} from '@/lib/offline/write-queue';
import {
  getSyncStatus,
  addSyncListener,
  processSyncQueue,
  type SyncEvent,
} from '@/lib/offline/sync-engine';

export type OfflineWritesState = {
  /** Number of pending (unsent) writes */
  pendingCount: number;
  /** Number of failed writes (after max retries) */
  failedCount: number;
  /** Total queued writes */
  totalCount: number;
  /** Whether the sync engine is currently processing */
  isSyncing: boolean;
  /** Timestamp of the last successful sync */
  lastSyncedAt: number | null;
  /** All queued writes (for UI display) */
  queuedWrites: QueuedWrite[];
  /** Failed writes only */
  failedWrites: QueuedWrite[];
  /** Retry all failed writes */
  retryFailed: () => Promise<void>;
  /** Discard a specific queued write */
  discard: (id: string) => Promise<void>;
  /** Manually trigger sync */
  triggerSync: () => Promise<void>;
};

export function useOfflineWrites(): OfflineWritesState {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [queuedWrites, setQueuedWrites] = useState<QueuedWrite[]>([]);
  const [failedWrites, setFailedWrites] = useState<QueuedWrite[]>([]);
  const mountedRef = useRef(true);

  const refreshState = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [pending, failed, allWrites, failedOnly, status] = await Promise.all([
        getPendingCount(),
        getFailedCount(),
        getQueuedWrites(),
        getQueuedWrites('failed'),
        Promise.resolve(getSyncStatus()),
      ]);

      if (!mountedRef.current) return;

      setPendingCount(pending);
      setFailedCount(failed);
      setQueuedWrites(allWrites);
      setFailedWrites(failedOnly);
      setIsSyncing(status.isSyncing);
      setLastSyncedAt(status.lastSyncedAt);
    } catch {
      // Silently ignore refresh errors
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshState();

    // Listen for queue updates
    const unsubQueue = onQueueUpdate(() => {
      void refreshState();
    });

    // Listen for sync events
    const unsubSync = addSyncListener((event: SyncEvent) => {
      if (!mountedRef.current) return;
      switch (event.type) {
        case 'sync:start':
          setIsSyncing(true);
          break;
        case 'sync:complete':
          setIsSyncing(false);
          setLastSyncedAt(Date.now());
          void refreshState();
          break;
        case 'sync:progress':
        case 'sync:error':
          void refreshState();
          break;
      }
    });

    return () => {
      mountedRef.current = false;
      unsubQueue();
      unsubSync();
    };
  }, [refreshState]);

  const retryFailed = useCallback(async () => {
    await retryAllFailed();
    await processSyncQueue();
    void refreshState();
  }, [refreshState]);

  const discard = useCallback(
    async (id: string) => {
      await discardWrite(id);
      void refreshState();
    },
    [refreshState],
  );

  const triggerSync = useCallback(async () => {
    await processSyncQueue();
    void refreshState();
  }, [refreshState]);

  return {
    pendingCount,
    failedCount,
    totalCount: pendingCount + failedCount,
    isSyncing,
    lastSyncedAt,
    queuedWrites,
    failedWrites,
    retryFailed,
    discard,
    triggerSync,
  };
}
