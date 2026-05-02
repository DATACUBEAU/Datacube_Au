/**
 * Offline Write Queue
 *
 * Intercepts write operations (POST/PUT/PATCH/DELETE) when the app is offline
 * and stores them in IndexedDB for later replay by the sync engine.
 *
 * Each queued operation carries an idempotency key to prevent duplicate
 * submissions when the sync engine replays.
 */

import { STORE_WRITE_QUEUE, STORE_SYNC_LOG, idbRead, idbWrite, idbGetAll, idbCount, idbDeleteByIndex } from './db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueuedWriteStatus = 'pending' | 'syncing' | 'failed';

export type QueuedWrite = {
  /** Unique ID for this queue entry (nanoid) */
  id: string;
  /** Idempotency key sent with the request to prevent duplicate server-side processing */
  idempotency_key: string;
  /** Target URL */
  url: string;
  /** HTTP method */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Serialised request body (JSON string, or null for DELETE) */
  body: string | null;
  /** Request headers snapshot */
  headers: Record<string, string>;
  /** Human-readable description of the operation (e.g. "Send chat message") */
  label: string;
  /** Current queue status */
  status: QueuedWriteStatus;
  /** Number of sync attempts so far */
  attempt_count: number;
  /** Last error message (if status === 'failed') */
  last_error: string | null;
  /** Unix-ms timestamp when the write was queued */
  created_at: number;
  /** Unix-ms timestamp of the last sync attempt */
  last_attempted_at: number | null;
};

export type SyncLogEntry = {
  /** The idempotency key that was synced */
  idempotency_key: string;
  /** The queue entry ID that produced this sync */
  queue_id: string;
  /** HTTP status code returned by the server */
  status: number;
  /** Unix-ms timestamp when the sync completed */
  synced_at: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_QUEUE_SIZE = 100;
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// ID generation – uses crypto.randomUUID (available in all modern browsers)
// ---------------------------------------------------------------------------

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

/**
 * Enqueue a write operation for later sync.
 * Returns the queued entry, or null if the queue is full.
 */
export async function enqueueWrite(input: {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  label?: string;
}): Promise<QueuedWrite | null> {
  // Check queue size limit
  const currentSize = await getQueueSize();
  if (currentSize >= MAX_QUEUE_SIZE) {
    console.warn('[write-queue] Queue is full, cannot enqueue new write.');
    return null;
  }

  const id = generateId();
  const idempotencyKey = generateId();
  const now = Date.now();

  const entry: QueuedWrite = {
    id,
    idempotency_key: idempotencyKey,
    url: input.url,
    method: input.method,
    body: input.body != null ? JSON.stringify(input.body) : null,
    headers: {
      ...(input.headers ?? {}),
      'x-idempotency-key': idempotencyKey,
    },
    label: input.label ?? `${input.method} ${input.url}`,
    status: 'pending',
    attempt_count: 0,
    last_error: null,
    created_at: now,
    last_attempted_at: null,
  };

  await idbWrite(STORE_WRITE_QUEUE, (store) => {
    store.put(entry);
  });

  // Notify listeners
  dispatchQueueUpdate();

  return entry;
}

/**
 * Get all queued writes, ordered by creation time (oldest first).
 */
export async function getQueuedWrites(
  statusFilter?: QueuedWriteStatus,
): Promise<QueuedWrite[]> {
  try {
    let writes: QueuedWrite[];
    if (statusFilter) {
      writes = await idbGetAll<QueuedWrite>(
        STORE_WRITE_QUEUE,
        'status',
        IDBKeyRange.only(statusFilter),
      );
    } else {
      writes = await idbGetAll<QueuedWrite>(STORE_WRITE_QUEUE);
    }
    return writes.sort((a, b) => a.created_at - b.created_at);
  } catch {
    return [];
  }
}

/**
 * Get pending writes ready for sync (pending status only).
 */
export async function getPendingWrites(): Promise<QueuedWrite[]> {
  return getQueuedWrites('pending');
}

/**
 * Get the total number of queued writes.
 */
export async function getQueueSize(): Promise<number> {
  try {
    return await idbCount(STORE_WRITE_QUEUE);
  } catch {
    return 0;
  }
}

/**
 * Get the number of pending (unsent) writes.
 */
export async function getPendingCount(): Promise<number> {
  try {
    return await idbCount(STORE_WRITE_QUEUE, 'status', IDBKeyRange.only('pending'));
  } catch {
    return 0;
  }
}

/**
 * Get the number of failed writes.
 */
export async function getFailedCount(): Promise<number> {
  try {
    return await idbCount(STORE_WRITE_QUEUE, 'status', IDBKeyRange.only('failed'));
  } catch {
    return 0;
  }
}

/**
 * Mark a queued write as syncing (being sent).
 */
export async function markWriteSyncing(id: string): Promise<void> {
  const entry = await idbRead<QueuedWrite | undefined>(STORE_WRITE_QUEUE, (store) =>
    store.get(id),
  );
  if (!entry) return;

  entry.status = 'syncing';
  entry.last_attempted_at = Date.now();
  entry.attempt_count += 1;

  await idbWrite(STORE_WRITE_QUEUE, (store) => {
    store.put(entry);
  });
}

/**
 * Mark a queued write as failed after a sync attempt.
 */
export async function markWriteFailed(id: string, error: string): Promise<void> {
  const entry = await idbRead<QueuedWrite | undefined>(STORE_WRITE_QUEUE, (store) =>
    store.get(id),
  );
  if (!entry) return;

  if (entry.attempt_count >= MAX_ATTEMPTS) {
    entry.status = 'failed';
  } else {
    entry.status = 'pending';
  }
  entry.last_error = error;

  await idbWrite(STORE_WRITE_QUEUE, (store) => {
    store.put(entry);
  });

  dispatchQueueUpdate();
}

/**
 * Remove a queued write after successful sync and log it.
 */
export async function completeWrite(id: string, httpStatus: number): Promise<void> {
  const entry = await idbRead<QueuedWrite | undefined>(STORE_WRITE_QUEUE, (store) =>
    store.get(id),
  );
  if (!entry) return;

  // Log to sync_log for deduplication
  const logEntry: SyncLogEntry = {
    idempotency_key: entry.idempotency_key,
    queue_id: id,
    status: httpStatus,
    synced_at: Date.now(),
  };

  await idbWrite(STORE_SYNC_LOG, (store) => {
    store.put(logEntry);
  });

  // Remove from queue
  await idbWrite(STORE_WRITE_QUEUE, (store) => {
    store.delete(id);
  });

  dispatchQueueUpdate();
}

/**
 * Check if an idempotency key has already been synced.
 */
export async function isAlreadySynced(idempotencyKey: string): Promise<boolean> {
  try {
    const entry = await idbRead<SyncLogEntry | undefined>(STORE_SYNC_LOG, (store) =>
      store.get(idempotencyKey),
    );
    return !!entry;
  } catch {
    return false;
  }
}

/**
 * Reset a failed write back to pending for manual retry.
 */
export async function retryFailedWrite(id: string): Promise<void> {
  const entry = await idbRead<QueuedWrite | undefined>(STORE_WRITE_QUEUE, (store) =>
    store.get(id),
  );
  if (!entry) return;

  entry.status = 'pending';
  entry.attempt_count = 0;
  entry.last_error = null;

  await idbWrite(STORE_WRITE_QUEUE, (store) => {
    store.put(entry);
  });

  dispatchQueueUpdate();
}

/**
 * Reset ALL failed writes to pending.
 */
export async function retryAllFailed(): Promise<number> {
  const failed = await getQueuedWrites('failed');
  for (const entry of failed) {
    entry.status = 'pending';
    entry.attempt_count = 0;
    entry.last_error = null;
    await idbWrite(STORE_WRITE_QUEUE, (store) => {
      store.put(entry);
    });
  }
  dispatchQueueUpdate();
  return failed.length;
}

/**
 * Remove a specific write from the queue (user-initiated discard).
 */
export async function discardWrite(id: string): Promise<void> {
  await idbWrite(STORE_WRITE_QUEUE, (store) => {
    store.delete(id);
  });
  dispatchQueueUpdate();
}

/**
 * Purge old sync log entries (older than 7 days).
 */
export async function purgeSyncLog(): Promise<number> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    return await idbDeleteByIndex(
      STORE_SYNC_LOG,
      'synced_at',
      IDBKeyRange.upperBound(cutoff),
    );
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Event dispatch – notifies React hooks of queue changes
// ---------------------------------------------------------------------------

const QUEUE_UPDATE_EVENT = 'dcau:write-queue-update';

function dispatchQueueUpdate(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_UPDATE_EVENT));
  }
}

export function onQueueUpdate(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(QUEUE_UPDATE_EVENT, callback);
  return () => window.removeEventListener(QUEUE_UPDATE_EVENT, callback);
}
