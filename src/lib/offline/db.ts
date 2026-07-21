/**
 * Central IndexedDB database manager for offline-first features.
 *
 * Manages three object stores:
 *   - `api_cache`   – cached API GET responses
 *   - `write_queue` – pending offline write operations
 *   - `sync_log`    – completed sync operations for deduplication
 *
 * Uses raw IDB API (no library dependency) consistent with the rest of the
 * codebase (user-cache.ts, kv-store.ts, upload/idb.ts).
 */

const DB_NAME = 'dcau_offline';
const DB_VERSION = 2;

const STORE_API_CACHE = 'api_cache';
const STORE_WRITE_QUEUE = 'write_queue';
const STORE_SYNC_LOG = 'sync_log';

export { STORE_API_CACHE, STORE_WRITE_QUEUE, STORE_SYNC_LOG };

let dbPromise: Promise<IDBDatabase> | null = null;

function isSensitiveQueuedHeaderName(name: string): boolean {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'x-idempotency-key') return false;
  if (
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'set-cookie' ||
    normalized === 'apikey' ||
    normalized === 'x-api-key' ||
    normalized === 'x-admin-token'
  ) {
    return true;
  }
  return normalized.includes('token') || normalized.includes('secret') || normalized.includes('key');
}

function sanitizeLegacyQueuedWriteHeaders(headers: unknown): Record<string, string> {
  const sanitized: Record<string, string> = {};
  if (!headers || typeof headers !== 'object') return sanitized;

  for (const [rawKey, rawValue] of Object.entries(headers as Record<string, unknown>)) {
    const key = String(rawKey || '').trim();
    if (!key || isSensitiveQueuedHeaderName(key)) continue;
    sanitized[key] = String(rawValue ?? '');
  }
  return sanitized;
}

function scrubLegacyQueuedWrites(store: IDBObjectStore): void {
  const cursorRequest = store.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;

    const record = cursor.value;
    if (record && typeof record === 'object') {
      const nextRecord = { ...(record as Record<string, unknown>) };
      nextRecord.headers = sanitizeLegacyQueuedWriteHeaders(nextRecord.headers);
      if (nextRecord.requires_auth !== false) {
        nextRecord.requires_auth = true;
        if (!String(nextRecord.user_id || '').trim()) {
          nextRecord.status = 'failed';
          nextRecord.last_error = 'AUTH_REQUIRED';
        }
      }
      cursor.update(nextRecord);
    }
    cursor.continue();
  };
}

function createOpenRequest(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      // api_cache: keyed by cache key (url+params hash)
      if (!db.objectStoreNames.contains(STORE_API_CACHE)) {
        const store = db.createObjectStore(STORE_API_CACHE, { keyPath: 'key' });
        store.createIndex('expires_at', 'expires_at', { unique: false });
      }

      // write_queue: keyed by operation id
      if (!db.objectStoreNames.contains(STORE_WRITE_QUEUE)) {
        const store = db.createObjectStore(STORE_WRITE_QUEUE, { keyPath: 'id' });
        store.createIndex('created_at', 'created_at', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }

      // sync_log: keyed by idempotency key
      if (!db.objectStoreNames.contains(STORE_SYNC_LOG)) {
        const store = db.createObjectStore(STORE_SYNC_LOG, { keyPath: 'idempotency_key' });
        store.createIndex('synced_at', 'synced_at', { unique: false });
      }

      if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_WRITE_QUEUE)) {
        const tx = request.transaction;
        if (tx) scrubLegacyQueuedWrites(tx.objectStore(STORE_WRITE_QUEUE));
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Opens (or reuses) the singleton IDB connection.  When the connection
 * closes unexpectedly (e.g. browser upgrade) we transparently reconnect.
 */
export function openOfflineDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = createOpenRequest().then((db) => {
    db.onclose = () => {
      dbPromise = null;
    };
    // versionchange fires when another tab opens a higher DB version –
    // closing gracefully prevents blocking the upgrade.
    db.onversionchange = () => {
      db.close();
      dbPromise = null;
    };
    return db;
  });

  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/**
 * Run a read-only transaction against a single store and return the result.
 */
export async function idbRead<T>(
  storeName: string,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openOfflineDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = callback(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Run a read-write transaction against a single store.
 */
export async function idbWrite(
  storeName: string,
  callback: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openOfflineDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    callback(store);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Get all records from a store, optionally filtering by index + range.
 */
export async function idbGetAll<T>(
  storeName: string,
  indexName?: string,
  range?: IDBKeyRange,
): Promise<T[]> {
  const db = await openOfflineDb();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const source = indexName ? store.index(indexName) : store;
    const req = source.getAll(range);
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Count records in a store.
 */
export async function idbCount(
  storeName: string,
  indexName?: string,
  range?: IDBKeyRange,
): Promise<number> {
  const db = await openOfflineDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const source = indexName ? store.index(indexName) : store;
    const req = source.count(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete all records in a store that match an index range.
 */
export async function idbDeleteByIndex(
  storeName: string,
  indexName: string,
  range: IDBKeyRange,
): Promise<number> {
  const db = await openOfflineDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const cursorReq = index.openCursor(range);
    let deleted = 0;

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      cursor.delete();
      deleted += 1;
      cursor.continue();
    };

    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
