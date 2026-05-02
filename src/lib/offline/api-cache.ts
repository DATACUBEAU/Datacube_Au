/**
 * API response cache layer backed by IndexedDB.
 *
 * Provides a simple get/set interface for caching serialised API responses
 * with TTL-based expiration.  Used by the SW cache strategy *and* by
 * application-level hooks as a fallback when the SW cache miss occurs.
 */

import { STORE_API_CACHE, idbRead, idbWrite, idbGetAll, idbDeleteByIndex } from './db';

export type ApiCacheRecord = {
  /** Cache key – deterministic hash of URL + sorted query params */
  key: string;
  /** Original request URL */
  url: string;
  /** HTTP method (always GET for cached responses) */
  method: string;
  /** Serialised response body (JSON string) */
  body: string;
  /** HTTP status code of the cached response */
  status: number;
  /** Response headers snapshot (subset) */
  headers: Record<string, string>;
  /** Unix-ms timestamp when the response was cached */
  cached_at: number;
  /** Unix-ms timestamp when the entry expires */
  expires_at: number;
  /** Schema version for forward-compat migrations */
  schema_version: number;
};

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join('|')}}`;
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildApiCacheKey(url: string, params?: Record<string, unknown>): string {
  const base = url.split('?')[0];
  const paramStr = params ? stableStringify(params) : '';
  return `api:${hashString(`${base}|${paramStr}`)}`;
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function getCachedApiResponse<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
): Promise<{ data: T | null; cachedAt: number | null; stale: boolean }> {
  const key = buildApiCacheKey(url, params);

  try {
    const record = await idbRead<ApiCacheRecord | undefined>(STORE_API_CACHE, (store) =>
      store.get(key),
    );

    if (!record || record.schema_version !== SCHEMA_VERSION) {
      return { data: null, cachedAt: null, stale: false };
    }

    const now = Date.now();
    const stale = now > record.expires_at;

    try {
      const parsed = JSON.parse(record.body) as T;
      return { data: parsed, cachedAt: record.cached_at, stale };
    } catch {
      return { data: null, cachedAt: null, stale: false };
    }
  } catch {
    return { data: null, cachedAt: null, stale: false };
  }
}

export async function setCachedApiResponse(
  url: string,
  params: Record<string, unknown> | undefined,
  data: unknown,
  options?: {
    ttlMs?: number;
    status?: number;
    headers?: Record<string, string>;
  },
): Promise<void> {
  const key = buildApiCacheKey(url, params);
  const now = Date.now();
  const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;

  const record: ApiCacheRecord = {
    key,
    url: url.split('?')[0],
    method: 'GET',
    body: JSON.stringify(data),
    status: options?.status ?? 200,
    headers: options?.headers ?? {},
    cached_at: now,
    expires_at: now + ttl,
    schema_version: SCHEMA_VERSION,
  };

  try {
    await idbWrite(STORE_API_CACHE, (store) => {
      store.put(record);
    });
  } catch {
    // Silently ignore write failures – offline cache is best-effort.
  }
}

export async function invalidateApiCache(url: string, params?: Record<string, unknown>): Promise<void> {
  const key = buildApiCacheKey(url, params);
  try {
    await idbWrite(STORE_API_CACHE, (store) => {
      store.delete(key);
    });
  } catch {
    // Ignore.
  }
}

/**
 * Purge all expired entries from the API cache.
 * Called periodically by the sync engine to keep storage lean.
 */
export async function purgeExpiredApiCache(): Promise<number> {
  const now = Date.now();
  try {
    return await idbDeleteByIndex(
      STORE_API_CACHE,
      'expires_at',
      IDBKeyRange.upperBound(now),
    );
  } catch {
    return 0;
  }
}

/**
 * Get all cached entries (primarily for the offline dashboard).
 */
export async function getAllCachedApiEntries(): Promise<ApiCacheRecord[]> {
  try {
    return await idbGetAll<ApiCacheRecord>(STORE_API_CACHE);
  } catch {
    return [];
  }
}
