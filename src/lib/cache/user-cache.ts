type CacheQuery = Record<string, unknown> | string | null | undefined;

export type UserCacheRecord<T = unknown> = {
  key: string;
  user_id: string;
  route: string;
  query_key: string;
  source: string;
  endpoint: string;
  schema_version: number;
  cached_at: number;
  ttl_ms: number | null;
  data: T;
};

type ReadOptions = {
  userId: string;
  route: string;
  source: string;
  endpoint: string;
  query?: CacheQuery;
  schemaVersion?: number;
  maxAgeMs?: number;
};

type WriteOptions<T> = ReadOptions & {
  data: T;
  ttlMs?: number | null;
};

const CACHE_PREFIX = 'dcau:cache:v1';
const LOCAL_FALLBACK_PREFIX = `${CACHE_PREFIX}:ls:`;
const DB_NAME = 'dcau_offline_cache';
const DB_VERSION = 1;
const STORE_NAME = 'resources';
const USER_INDEX = 'user_id';

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed) return '/';
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const serialized = entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join('|');
  return `{${serialized}}`;
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function queryToKey(query: CacheQuery): string {
  const serialized = stableStringify(query);
  if (!serialized) return 'no-query';
  return hashString(serialized);
}

function fallbackStorageKey(key: string): string {
  return `${LOCAL_FALLBACK_PREFIX}${key}`;
}

export function buildUserCacheKey(input: {
  userId: string;
  route: string;
  source: string;
  endpoint: string;
  query?: CacheQuery;
  schemaVersion?: number;
}): { key: string; queryKey: string; schemaVersion: number; route: string } {
  const route = normalizeRoute(input.route);
  const queryKey = queryToKey(input.query);
  const schemaVersion = Number.isFinite(input.schemaVersion) ? Number(input.schemaVersion) : 1;
  const key = [
    CACHE_PREFIX,
    input.userId,
    route,
    input.source.trim() || 'unknown',
    input.endpoint.trim() || 'unknown',
    `q:${queryKey}`,
    `s:${schemaVersion}`,
  ].join(':');
  return { key, queryKey, schemaVersion, route };
}

function canUseIndexedDb() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME) ?? null
        : db.createObjectStore(STORE_NAME, { keyPath: 'key' });

      if (store && !store.indexNames.contains(USER_INDEX)) {
        store.createIndex(USER_INDEX, 'user_id', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<UserCacheRecord<T> | null> {
  const db = await openDb();
  try {
    const value = await new Promise<UserCacheRecord<T> | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as UserCacheRecord<T> | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    return value;
  } finally {
    db.close();
  }
}

async function idbSet<T>(record: UserCacheRecord<T>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDeleteByUser(userId: string): Promise<number> {
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index(USER_INDEX);
      const cursorRequest = index.openCursor(IDBKeyRange.only(userId));
      let removed = 0;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function localGet<T>(key: string): UserCacheRecord<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(fallbackStorageKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as UserCacheRecord<T>;
  } catch {
    return null;
  }
}

function localSet<T>(record: UserCacheRecord<T>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(fallbackStorageKey(record.key), JSON.stringify(record));
  } catch {
    // Ignore localStorage quota errors.
  }
}

function localDeleteByUser(userId: string): number {
  if (typeof window === 'undefined') return 0;
  let removed = 0;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LOCAL_FALLBACK_PREFIX)) continue;
    if (key.includes(`:${userId}:`)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
    removed += 1;
  }
  return removed;
}

function isRecordValid<T>(
  record: UserCacheRecord<T> | null,
  opts: { userId: string; schemaVersion: number; maxAgeMs?: number },
): record is UserCacheRecord<T> {
  if (!record) return false;
  if (record.user_id !== opts.userId) return false;
  if (record.schema_version !== opts.schemaVersion) return false;

  const now = Date.now();
  if (typeof record.ttl_ms === 'number' && record.ttl_ms > 0 && now - record.cached_at > record.ttl_ms) {
    return false;
  }
  if (typeof opts.maxAgeMs === 'number' && opts.maxAgeMs > 0 && now - record.cached_at > opts.maxAgeMs) {
    return false;
  }
  return true;
}

export async function readUserCache<T = unknown>(
  opts: ReadOptions,
): Promise<{ data: T | null; cachedAt: number | null }> {
  const { key, schemaVersion } = buildUserCacheKey({
    userId: opts.userId,
    route: opts.route,
    source: opts.source,
    endpoint: opts.endpoint,
    query: opts.query,
    schemaVersion: opts.schemaVersion,
  });

  const validation = {
    userId: opts.userId,
    schemaVersion,
    maxAgeMs: opts.maxAgeMs,
  };

  if (canUseIndexedDb()) {
    try {
      const record = await idbGet<T>(key);
      if (isRecordValid(record, validation)) {
        return { data: record.data, cachedAt: record.cached_at };
      }
    } catch {
      // Fallback to localStorage below.
    }
  }

  const local = localGet<T>(key);
  if (isRecordValid(local, validation)) {
    return { data: local.data, cachedAt: local.cached_at };
  }

  return { data: null, cachedAt: null };
}

export async function writeUserCache<T>(opts: WriteOptions<T>): Promise<void> {
  const { key, queryKey, schemaVersion, route } = buildUserCacheKey({
    userId: opts.userId,
    route: opts.route,
    source: opts.source,
    endpoint: opts.endpoint,
    query: opts.query,
    schemaVersion: opts.schemaVersion,
  });

  const record: UserCacheRecord<T> = {
    key,
    user_id: opts.userId,
    route,
    query_key: queryKey,
    source: opts.source,
    endpoint: opts.endpoint,
    schema_version: schemaVersion,
    cached_at: Date.now(),
    ttl_ms: typeof opts.ttlMs === 'number' ? opts.ttlMs : null,
    data: opts.data,
  };

  if (canUseIndexedDb()) {
    try {
      await idbSet(record);
      return;
    } catch {
      // Fallback to localStorage below.
    }
  }

  localSet(record);
}

export async function clearUserCache(userId: string): Promise<number> {
  let removed = 0;
  if (canUseIndexedDb()) {
    try {
      removed += await idbDeleteByUser(userId);
    } catch {
      // Ignore and continue with fallback cleanup.
    }
  }
  removed += localDeleteByUser(userId);
  return removed;
}

