/**
 * Sync Engine
 *
 * Processes the offline write queue when connectivity is restored.
 * Replays queued writes in FIFO order with exponential backoff,
 * deduplication via idempotency keys, and event emission for UI.
 */

import {
  getPendingWrites,
  markWriteSyncing,
  markWriteFailed,
  completeWrite,
  isAlreadySynced,
  purgeSyncLog,
  onQueueUpdate,
  canReplayQueuedWriteForUser,
  sanitizeQueuedWriteHeaders,
  type QueuedWrite,
} from './write-queue';
import { purgeExpiredApiCache } from './api-cache';
import { requestBackgroundSync, listenForSyncMessages } from './sync-worker-plugin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncEvent =
  | { type: 'sync:start' }
  | { type: 'sync:progress'; completed: number; total: number; current: QueuedWrite }
  | { type: 'sync:complete'; completed: number; failed: number }
  | { type: 'sync:error'; error: string; entry: QueuedWrite };

type SyncListener = (event: SyncEvent) => void;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isSyncing = false;
let lastSyncedAt: number | null = null;
const listeners = new Set<SyncListener>();

// ---------------------------------------------------------------------------
// Listener management
// ---------------------------------------------------------------------------

export function addSyncListener(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: SyncEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.warn('[sync-engine] Listener error:', e);
    }
  }

  // Also dispatch a DOM event for components that use addEventListener
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('dcau:sync-event', { detail: event }),
    );
  }
}

// ---------------------------------------------------------------------------
// Status queries
// ---------------------------------------------------------------------------

export function getSyncStatus(): {
  isSyncing: boolean;
  lastSyncedAt: number | null;
} {
  return { isSyncing, lastSyncedAt };
}

// ---------------------------------------------------------------------------
// Retry delay with exponential backoff
// ---------------------------------------------------------------------------

function getRetryDelayMs(attemptCount: number): number {
  // 1s, 2s, 4s (capped at 4s)
  const base = 1000;
  const delay = base * Math.pow(2, Math.min(attemptCount - 1, 2));
  // Add jitter ± 20%
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.max(500, Math.round(delay + jitter));
}

async function resolveReplayAuth(): Promise<{ userId: string | null; accessToken: string | null }> {
  try {
    const { resolveBrowserSession } = await import('@/lib/supabase-client/client');
    const resolved = await resolveBrowserSession({ forceRefresh: true });
    return {
      userId: resolved.session?.user?.id ?? null,
      accessToken: resolved.session?.access_token ?? null,
    };
  } catch {
    return { userId: null, accessToken: null };
  }
}

// ---------------------------------------------------------------------------
// Core sync loop
// ---------------------------------------------------------------------------

/**
 * Process all pending writes in the queue.
 * Called automatically when connectivity is restored, or manually.
 */
export async function processSyncQueue(): Promise<{
  completed: number;
  failed: number;
}> {
  if (isSyncing) {
    return { completed: 0, failed: 0 };
  }

  // Check if we're online
  if (typeof window !== 'undefined' && !window.navigator.onLine) {
    return { completed: 0, failed: 0 };
  }

  const pending = await getPendingWrites();
  if (pending.length === 0) {
    return { completed: 0, failed: 0 };
  }

  isSyncing = true;
  emit({ type: 'sync:start' });

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];

    // Check if already synced (deduplication)
    const alreadySynced = await isAlreadySynced(entry.idempotency_key);
    if (alreadySynced) {
      // Already processed; remove from queue
      await completeWrite(entry.id, 200);
      completed += 1;
      emit({
        type: 'sync:progress',
        completed: completed + failed,
        total: pending.length,
        current: entry,
      });
      continue;
    }

    // Mark as syncing
    await markWriteSyncing(entry.id);

    emit({
      type: 'sync:progress',
      completed: completed + failed,
      total: pending.length,
      current: entry,
    });

    try {
      const requiresAuth = entry.requires_auth !== false;
      const auth = requiresAuth
        ? await resolveReplayAuth()
        : { userId: null, accessToken: null };

      if (!canReplayQueuedWriteForUser(entry, auth.userId)) {
        const message = auth.userId ? 'AUTH_USER_MISMATCH' : 'AUTH_REQUIRED';
        await markWriteFailed(entry.id, message);
        failed += 1;
        emit({ type: 'sync:error', error: message, entry });
        continue;
      }

      const replayHeaders: Record<string, string> = {
        ...sanitizeQueuedWriteHeaders(entry.headers),
        'Content-Type': entry.headers['Content-Type'] || entry.headers['content-type'] || 'application/json',
      };
      if (requiresAuth) {
        if (!auth.accessToken) {
          await markWriteFailed(entry.id, 'AUTH_REQUIRED');
          failed += 1;
          emit({ type: 'sync:error', error: 'AUTH_REQUIRED', entry });
          continue;
        }
        replayHeaders.Authorization = `Bearer ${auth.accessToken}`;
      }

      const response = await fetch(entry.url, {
        method: entry.method,
        headers: replayHeaders,
        body: entry.body,
        credentials: 'include',
      });

      if (response.ok || response.status === 201 || response.status === 204) {
        await completeWrite(entry.id, response.status);
        completed += 1;
      } else if (response.status === 409) {
        // Conflict – likely a duplicate or already-processed request.
        // Treat as success (last-write-wins / server-side dedup).
        console.warn('[sync-engine] 409 conflict for entry, treating as completed:', entry.id);
        await completeWrite(entry.id, response.status);
        completed += 1;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        // Client error (not rate-limited) – no point retrying
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        await markWriteFailed(entry.id, `HTTP ${response.status}: ${errorText.slice(0, 200)}`);
        failed += 1;
        emit({
          type: 'sync:error',
          error: `HTTP ${response.status}`,
          entry,
        });
      } else {
        // Server error or rate limit – retry later
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        await markWriteFailed(entry.id, `HTTP ${response.status}: ${errorText.slice(0, 200)}`);

        // Wait before next attempt
        const delay = getRetryDelayMs(entry.attempt_count + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));

        failed += 1;
        emit({
          type: 'sync:error',
          error: `HTTP ${response.status} (will retry)`,
          entry,
        });
      }
    } catch (error: any) {
      // Network error – stop processing (we're probably offline again)
      const message = String(error?.message || error || 'Network error');
      await markWriteFailed(entry.id, message);
      failed += 1;

      emit({ type: 'sync:error', error: message, entry });

      // If it looks like a network failure, stop the queue
      if (
        error?.name === 'TypeError' ||
        message.toLowerCase().includes('network') ||
        message.toLowerCase().includes('fetch')
      ) {
        break;
      }
    }
  }

  isSyncing = false;
  lastSyncedAt = Date.now();

  emit({ type: 'sync:complete', completed, failed });

  return { completed, failed };
}

// ---------------------------------------------------------------------------
// Auto-sync on connectivity change
// ---------------------------------------------------------------------------

let cleanupFn: (() => void) | null = null;

/**
 * Start the sync engine – listens for online/visibility events and
 * automatically processes the queue.
 *
 * Returns a cleanup function to tear down listeners.
 */
export function startSyncEngine(): () => void {
  if (typeof window === 'undefined') return () => {};

  // Prevent double-init
  if (cleanupFn) return cleanupFn;

  const handleOnline = () => {
    // Small delay to let DNS/routes stabilise
    setTimeout(() => {
      void processSyncQueue();
    }, 1500);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && window.navigator.onLine) {
      void processSyncQueue();
    }
  };

  // When a write is queued, register Background Sync so the browser
  // can wake us even if the tab is closed.
  const unsubQueueUpdate = onQueueUpdate(() => {
    void requestBackgroundSync();
  });

  // Listen for SW messages requesting sync (from Background Sync events)
  const unsubSyncMessages = listenForSyncMessages(() => {
    void processSyncQueue();
  });

  // Periodic maintenance (every 5 minutes)
  const maintenanceInterval = window.setInterval(() => {
    void purgeExpiredApiCache();
    void purgeSyncLog();
    if (window.navigator.onLine) {
      void processSyncQueue();
    }
  }, 5 * 60 * 1000);

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Process any pending writes on startup
  if (window.navigator.onLine) {
    setTimeout(() => void processSyncQueue(), 3000);
  }

  cleanupFn = () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.clearInterval(maintenanceInterval);
    unsubQueueUpdate();
    unsubSyncMessages();
    cleanupFn = null;
  };

  return cleanupFn;
}
