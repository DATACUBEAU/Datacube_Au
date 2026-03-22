import { safeFetch } from '@/lib/api/safe-fetch';
import { readUserCache } from '@/lib/cache/user-cache';
import {
  ACCOUNT_SNAPSHOT_CACHE_SCHEMA,
  ACCOUNT_SNAPSHOT_CACHE_TTL_MS,
  ACCOUNT_SNAPSHOT_LEGACY_ROUTE,
  ACCOUNT_SNAPSHOT_ROUTE,
  ACCOUNT_SNAPSHOT_SOURCE,
  normalizeAccountSnapshotPayload,
  readPersistedAccountSnapshotSync,
  type PersistedCanonicalAccountSnapshot,
} from './account-snapshot-cache';

export type CachedCanonicalAccountSnapshot = {
  snapshot: PersistedCanonicalAccountSnapshot | null;
  cachedAt: number | null;
  source: 'sync' | 'cache' | 'legacy-cache' | 'none';
};

type FetchCanonicalAccountSnapshotOptions = {
  userId: string;
  accessToken?: string | null;
  timeoutMs?: number;
  silent?: boolean;
  suppressAuthError?: boolean;
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
  useSafeFetch?: boolean;
};

export async function readCanonicalAccountSnapshotCache(
  userId: string,
): Promise<CachedCanonicalAccountSnapshot> {
  const cached = await readUserCache<unknown>({
    userId,
    route: ACCOUNT_SNAPSHOT_ROUTE,
    source: ACCOUNT_SNAPSHOT_SOURCE,
    endpoint: 'get',
    schemaVersion: ACCOUNT_SNAPSHOT_CACHE_SCHEMA,
    maxAgeMs: ACCOUNT_SNAPSHOT_CACHE_TTL_MS,
  });

  if (cached.data !== null && cached.data !== undefined) {
    return {
      snapshot: normalizeAccountSnapshotPayload(cached.data, userId),
      cachedAt: cached.cachedAt,
      source: 'cache',
    };
  }

  const legacyCached = await readUserCache<unknown>({
    userId,
    route: ACCOUNT_SNAPSHOT_LEGACY_ROUTE,
    source: ACCOUNT_SNAPSHOT_SOURCE,
    endpoint: 'get',
    schemaVersion: ACCOUNT_SNAPSHOT_CACHE_SCHEMA,
    maxAgeMs: ACCOUNT_SNAPSHOT_CACHE_TTL_MS,
  });

  return {
    snapshot: normalizeAccountSnapshotPayload(legacyCached.data, userId),
    cachedAt: legacyCached.cachedAt,
    source: legacyCached.data === null || legacyCached.data === undefined ? 'none' : 'legacy-cache',
  };
}

export async function resolveCanonicalAccountSnapshotClientFallback(
  userId: string,
): Promise<CachedCanonicalAccountSnapshot> {
  const syncSnapshot = readPersistedAccountSnapshotSync(userId);
  if (syncSnapshot.snapshot) {
    return {
      snapshot: syncSnapshot.snapshot,
      cachedAt: syncSnapshot.cachedAt,
      source: 'sync',
    };
  }
  return readCanonicalAccountSnapshotCache(userId);
}

export async function fetchCanonicalAccountSnapshotFromApi(
  opts: FetchCanonicalAccountSnapshotOptions,
): Promise<{
  response: Response;
  payload: unknown;
  snapshot: PersistedCanonicalAccountSnapshot | null;
}> {
  const headers = new Headers();
  if (opts.accessToken) {
    headers.set('Authorization', `Bearer ${opts.accessToken}`);
  }

  const requestInit: RequestInit & { timeout?: number; silent?: boolean } = {
    method: 'GET',
    headers,
    credentials: opts.credentials ?? 'include',
    cache: 'no-store',
  };

  let response: Response;
  if (opts.useSafeFetch !== false) {
    response = await safeFetch(`/api${ACCOUNT_SNAPSHOT_ROUTE}`, {
      ...requestInit,
      timeout: opts.timeoutMs ?? 10_000,
      silent: opts.silent ?? true,
      suppressAuthError: opts.suppressAuthError ?? true,
    });
  } else {
    const fetchImpl = opts.fetchImpl ?? fetch;
    response = await fetchImpl(`/api${ACCOUNT_SNAPSHOT_ROUTE}`, requestInit);
  }

  const payload = await response.json().catch(() => null);
  return {
    response,
    payload,
    snapshot: normalizeAccountSnapshotPayload(payload, opts.userId),
  };
}
