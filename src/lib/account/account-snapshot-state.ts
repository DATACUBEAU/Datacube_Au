import type { PersistedCanonicalAccountSnapshot } from './account-snapshot-cache';

export type AccountSnapshotState<TSnapshot = PersistedCanonicalAccountSnapshot> = {
  snapshot: TSnapshot | null;
  loading: boolean;
  isUsingCachedData: boolean;
  cachedAt: number | null;
};

export type AccountSnapshotFailureKind =
  | 'offline'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'unknown';

export type ResolvedAccountSnapshotFailure<TSnapshot = PersistedCanonicalAccountSnapshot> =
  AccountSnapshotState<TSnapshot> & {
    clearPersistedSnapshot: boolean;
    reason: AccountSnapshotFailureKind;
  };

export type AccountSnapshotRefreshDecision = {
  shouldFetch: boolean;
  reason: 'forced' | 'missing-cache' | 'expired-cache' | 'fresh-cache';
};

function normalizeErrorMessage(error: unknown): string {
  return String((error as any)?.message || '').trim().toLowerCase();
}

export function classifyAccountSnapshotFailure(error: unknown): AccountSnapshotFailureKind {
  const status = Number((error as any)?.status || 0);
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const name = String((error as any)?.name || '').trim();
  const message = normalizeErrorMessage(error);

  if (status === 401 || code === 'AUTH_REQUIRED') return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (name === 'OfflineError' || message.includes('offline')) return 'offline';
  if (name === 'AbortError' || message.includes('timed out') || message.includes('timeout')) return 'timeout';
  if (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('fetch failed')
  ) {
    return 'network';
  }
  return 'unknown';
}

export function resolveBootstrapAccountSnapshotState<TSnapshot>(
  snapshot: TSnapshot | null,
  cachedAt: number | null,
): AccountSnapshotState<TSnapshot> {
  return {
    snapshot,
    loading: !snapshot,
    isUsingCachedData: Boolean(snapshot),
    cachedAt: snapshot ? cachedAt : null,
  };
}

export function shouldDeferAccountSnapshotBootstrap(input: {
  hasUser: boolean;
  isLoadingAuth: boolean;
  runtimeAuthState: 'RESTORING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'EXPIRED' | 'REAUTH_IN_PROGRESS';
}): boolean {
  if (!input.hasUser) return false;
  if (input.isLoadingAuth) return true;
  return input.runtimeAuthState === 'RESTORING';
}

export function isAccountSnapshotCacheFresh(input: {
  cachedAt: number | null | undefined;
  ttlMs: number;
  nowMs?: number;
}): boolean {
  const cachedAt = Number(input.cachedAt);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return false;

  const ttlMs = Number(input.ttlMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;

  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  return nowMs - cachedAt < ttlMs;
}

export function resolveAccountSnapshotRefreshDecision(input: {
  cachedAt: number | null | undefined;
  ttlMs: number;
  force?: boolean;
  nowMs?: number;
}): AccountSnapshotRefreshDecision {
  if (input.force) {
    return { shouldFetch: true, reason: 'forced' };
  }

  if (!Number.isFinite(Number(input.cachedAt)) || Number(input.cachedAt) <= 0) {
    return { shouldFetch: true, reason: 'missing-cache' };
  }

  if (isAccountSnapshotCacheFresh(input)) {
    return { shouldFetch: false, reason: 'fresh-cache' };
  }

  return { shouldFetch: true, reason: 'expired-cache' };
}

export function resolveSuccessfulAccountSnapshotState<TSnapshot>(
  snapshot: TSnapshot,
  cachedAt: number,
): AccountSnapshotState<TSnapshot> {
  return {
    snapshot,
    loading: false,
    isUsingCachedData: false,
    cachedAt,
  };
}

export function resolveFailedAccountSnapshotState<TSnapshot>(input: {
  error: unknown;
  cachedSnapshot: TSnapshot | null;
  cachedAt: number | null;
  currentSnapshot: TSnapshot | null;
  currentCachedAt: number | null;
}): ResolvedAccountSnapshotFailure<TSnapshot> {
  const reason = classifyAccountSnapshotFailure(input.error);

  if (reason === 'unauthorized' || reason === 'forbidden') {
    return {
      snapshot: null,
      loading: false,
      isUsingCachedData: false,
      cachedAt: null,
      clearPersistedSnapshot: true,
      reason,
    };
  }

  const fallbackSnapshot = input.cachedSnapshot ?? input.currentSnapshot;
  const fallbackCachedAt =
    input.cachedSnapshot !== null && input.cachedSnapshot !== undefined
      ? input.cachedAt
      : input.currentCachedAt;

  if (fallbackSnapshot) {
    return {
      snapshot: fallbackSnapshot,
      loading: false,
      isUsingCachedData: true,
      cachedAt: fallbackCachedAt ?? null,
      clearPersistedSnapshot: false,
      reason,
    };
  }

  return {
    snapshot: null,
    loading: false,
    isUsingCachedData: false,
    cachedAt: null,
    clearPersistedSnapshot: false,
    reason,
  };
}
