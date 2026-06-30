'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '@/lib/supabase-client/client';
import { writeUserCache } from '@/lib/cache/user-cache';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import {
  fetchCanonicalAccountSnapshotFromApi,
  readCanonicalAccountSnapshotCache,
} from '@/lib/account/account-snapshot-client';
import {
  ACCOUNT_SNAPSHOT_CACHE_SCHEMA,
  ACCOUNT_SNAPSHOT_CACHE_TTL_MS,
  ACCOUNT_SNAPSHOT_ROUTE,
  ACCOUNT_SNAPSHOT_SOURCE,
  clearPersistedAccountSnapshotSync,
  resolveCachedAccountSnapshotFallback,
  readPersistedAccountSnapshotSync,
  writePersistedAccountSnapshotSync,
  type PersistedCanonicalAccountSnapshot,
} from '@/lib/account/account-snapshot-cache';
import {
  isAccountSnapshotCacheFresh,
  resolveAccountSnapshotRefreshDecision,
  resolveBootstrapAccountSnapshotState,
  resolveFailedAccountSnapshotState,
  resolveSuccessfulAccountSnapshotState,
  shouldDeferAccountSnapshotBootstrap,
} from '@/lib/account/account-snapshot-state';
import { clearUserScopedClientCaches } from '@/lib/auth/session-storage';
import {
  recordClientEgressMetric,
  recordRealtimeChannelSnapshot,
} from '@/lib/observability/egress-metrics';

type AccountSnapshotContextValue = {
  snapshot: PersistedCanonicalAccountSnapshot | null;
  loading: boolean;
  isUsingCachedData: boolean;
  cachedAt: number | null;
  refresh: () => Promise<PersistedCanonicalAccountSnapshot | null>;
};

const SNAPSHOT_MIN_REFRESH_INTERVAL_MS = 15_000;
const ACCOUNT_SNAPSHOT_INVALIDATED_EVENT = 'dcau:account-snapshot-invalidated';

const AccountSnapshotContext = createContext<AccountSnapshotContextValue>({
  snapshot: null,
  loading: true,
  isUsingCachedData: false,
  cachedAt: null,
  refresh: async () => null,
});

type CachedSnapshotResult = {
  snapshot: PersistedCanonicalAccountSnapshot | null;
  cachedAt: number | null;
};

function hasActivePaidSnapshotAccess(snapshot: PersistedCanonicalAccountSnapshot | null): boolean {
  const entitlements = snapshot?.entitlements;
  if (!entitlements) return false;
  const plan = String(entitlements.plan || '').trim().toLowerCase();
  const endsAt = typeof entitlements.entitlementEndsAt === 'string'
    ? entitlements.entitlementEndsAt
    : null;
  const expiresMs = endsAt ? new Date(endsAt).getTime() : null;
  const expired = Number.isFinite(expiresMs) && Number(expiresMs) <= Date.now();
  if (expired) return false;
  return (
    entitlements.hasPro === true ||
    entitlements.promoActive === true ||
    plan === 'admin' ||
    plan === 'premium' ||
    plan === 'pro' ||
    plan === 'promo_pro'
  );
}

export function AccountSnapshotProvider({ children }: { children: React.ReactNode }) {
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { isOnline } = useNetworkStatus();
  const { isAuthLocked, isRestoringAuth, runtimeAuthState } = useSmartAuth();
  const initialSyncSnapshot = user?.id ? readPersistedAccountSnapshotSync(user.id) : { snapshot: null, cachedAt: null };
  const bootstrapState = resolveBootstrapAccountSnapshotState(
    initialSyncSnapshot.snapshot,
    initialSyncSnapshot.cachedAt,
  );

  const [snapshot, setSnapshot] = useState<PersistedCanonicalAccountSnapshot | null>(bootstrapState.snapshot);
  const [loading, setLoading] = useState(bootstrapState.loading);
  const [isUsingCachedData, setIsUsingCachedData] = useState(bootstrapState.isUsingCachedData);
  const [cachedAt, setCachedAt] = useState<number | null>(bootstrapState.cachedAt);
  const shouldDeferBootstrap = shouldDeferAccountSnapshotBootstrap({
    hasUser: Boolean(user?.id),
    isLoadingAuth,
    runtimeAuthState,
  });

  const snapshotRef = useRef<PersistedCanonicalAccountSnapshot | null>(bootstrapState.snapshot);
  const cachedAtRef = useRef<number | null>(bootstrapState.cachedAt);
  const currentUserIdRef = useRef<string | null>(user?.id ?? null);
  const inflightFetchRef = useRef<Promise<PersistedCanonicalAccountSnapshot | null> | null>(null);
  const fetchSequenceRef = useRef(0);
  const latestAppliedFetchSequenceRef = useRef(0);
  const lastNetworkFetchAtRef = useRef(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    cachedAtRef.current = cachedAt;
  }, [cachedAt]);

  const applySnapshot = useCallback((next: PersistedCanonicalAccountSnapshot, options?: {
    cachedAt?: number | null;
    fromCache?: boolean;
  }) => {
    const previous = snapshotRef.current;
    const userId = next.userId || user?.id || null;
    if (
      userId &&
      previous?.userId === userId &&
      hasActivePaidSnapshotAccess(previous) &&
      !hasActivePaidSnapshotAccess(next)
    ) {
      void clearUserScopedClientCaches(userId);
    }
    snapshotRef.current = next;
    cachedAtRef.current = options?.cachedAt ?? Date.now();
    setSnapshot(next);
    setLoading(false);
    setIsUsingCachedData(Boolean(options?.fromCache));
    setCachedAt(options?.cachedAt ?? Date.now());
  }, [user?.id]);

  const clearSnapshot = useCallback(() => {
    snapshotRef.current = null;
    cachedAtRef.current = null;
    setSnapshot(null);
    setLoading(false);
    setIsUsingCachedData(false);
    setCachedAt(null);
  }, []);

  const readCachedSnapshot = useCallback(async (): Promise<CachedSnapshotResult> => {
    if (!user?.id) return { snapshot: null, cachedAt: null };
    const cached = await readCanonicalAccountSnapshotCache(user.id);
    return {
      snapshot: cached.snapshot,
      cachedAt: cached.cachedAt,
    };
  }, [user?.id]);

  const writeCachedSnapshot = useCallback(async (
    next: PersistedCanonicalAccountSnapshot,
    nextCachedAt: number,
  ) => {
    if (!user?.id) return;
    await writeUserCache({
      userId: user.id,
      route: ACCOUNT_SNAPSHOT_ROUTE,
      source: ACCOUNT_SNAPSHOT_SOURCE,
      endpoint: 'get',
      schemaVersion: ACCOUNT_SNAPSHOT_CACHE_SCHEMA,
      ttlMs: ACCOUNT_SNAPSHOT_CACHE_TTL_MS,
      data: next,
    });
    writePersistedAccountSnapshotSync(next, nextCachedAt);
  }, [user?.id]);

  const fetchSnapshot = useCallback((opts?: {
    silent?: boolean;
    force?: boolean;
    reason?: string;
  }): Promise<PersistedCanonicalAccountSnapshot | null> => {
    if (!user?.id) {
      clearSnapshot();
      return Promise.resolve(null);
    }

    if (isAuthLocked || isRestoringAuth) {
      return Promise.resolve(snapshotRef.current);
    }

    if (inflightFetchRef.current) {
      recordClientEgressMetric('account_snapshot.request_deduped', {
        reason: opts?.reason || null,
      });
      return inflightFetchRef.current;
    }

    if (
      !opts?.force &&
      opts?.silent &&
      snapshotRef.current &&
      lastNetworkFetchAtRef.current > 0 &&
      Date.now() - lastNetworkFetchAtRef.current < SNAPSHOT_MIN_REFRESH_INTERVAL_MS
    ) {
      recordClientEgressMetric('account_snapshot.refresh_throttled', {
        reason: opts?.reason || null,
      });
      return Promise.resolve(snapshotRef.current);
    }

    const refreshDecision = resolveAccountSnapshotRefreshDecision({
      cachedAt: cachedAtRef.current,
      ttlMs: ACCOUNT_SNAPSHOT_CACHE_TTL_MS,
      force: opts?.force,
    });

    if (!refreshDecision.shouldFetch && snapshotRef.current) {
      recordClientEgressMetric('account_snapshot.cache_hit', {
        source: 'memory',
        reason: opts?.reason || refreshDecision.reason,
      });
      setLoading(false);
      setIsUsingCachedData(true);
      return Promise.resolve(snapshotRef.current);
    }

    if (!opts?.silent && !snapshotRef.current) {
      setLoading(true);
    }

    const requestPromise = (async () => {
      const cached = await readCachedSnapshot();

      if (
        !opts?.force &&
        cached.snapshot &&
        isAccountSnapshotCacheFresh({
          cachedAt: cached.cachedAt,
          ttlMs: ACCOUNT_SNAPSHOT_CACHE_TTL_MS,
        })
      ) {
        recordClientEgressMetric('account_snapshot.cache_hit', {
          source: 'user-cache',
          reason: opts?.reason || 'fresh-cache',
        });
        applySnapshot(cached.snapshot, { cachedAt: cached.cachedAt, fromCache: true });
        return cached.snapshot;
      }

      if (!cached.snapshot) {
        recordClientEgressMetric('account_snapshot.cache_miss', {
          reason: opts?.reason || refreshDecision.reason,
        });
      }

      if (!session?.access_token || !isOnline) {
        const fallback = resolveCachedAccountSnapshotFallback({
          cachedSnapshot: cached.snapshot,
          cachedAt: cached.cachedAt,
          previousSnapshot: snapshotRef.current,
          previousCachedAt: cachedAtRef.current,
        });
        if (fallback.snapshot) {
          applySnapshot(fallback.snapshot, { cachedAt: fallback.cachedAt, fromCache: fallback.fromCache });
          return fallback.snapshot;
        }
        setLoading(false);
        return null;
      }

      const fetchSequence = fetchSequenceRef.current + 1;
      fetchSequenceRef.current = fetchSequence;
      const requestUserId = user.id;
      recordClientEgressMetric('account_snapshot.fetch_started', {
        reason: opts?.reason || refreshDecision.reason,
      });

      try {
        let snapshotResponse = await fetchCanonicalAccountSnapshotFromApi({
          userId: user.id,
          accessToken: session.access_token,
          timeoutMs: 10_000,
          silent: true,
          suppressAuthError: true,
        });
        if (snapshotResponse.response.status === 401) {
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshed.session?.access_token) {
            snapshotResponse = await fetchCanonicalAccountSnapshotFromApi({
              userId: user.id,
              accessToken: refreshed.session.access_token,
              timeoutMs: 10_000,
              silent: true,
              suppressAuthError: true,
            });
          }
        }

        const { response, payload, snapshot: normalized } = snapshotResponse;
        if (response.status === 401 || response.status === 403) {
          const authError: Error & { status?: number } = new Error(
            `${ACCOUNT_SNAPSHOT_ROUTE} failed (${response.status})`,
          );
          authError.status = response.status;
          throw authError;
        }
        if (!response.ok || !normalized) {
          const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {};
          const requestError: Error & { status?: number } = new Error(
            String(
              payloadRecord.message ||
              payloadRecord.error ||
              `${ACCOUNT_SNAPSHOT_ROUTE} failed (${response.status})`,
            ),
          );
          requestError.status = response.status;
          throw requestError;
        }

        if (
          currentUserIdRef.current !== requestUserId ||
          fetchSequence < latestAppliedFetchSequenceRef.current
        ) {
          recordClientEgressMetric('account_snapshot.stale_response_ignored', {
            reason: opts?.reason || null,
          });
          return snapshotRef.current;
        }

        const nextCachedAt = Date.now();
        lastNetworkFetchAtRef.current = nextCachedAt;
        latestAppliedFetchSequenceRef.current = fetchSequence;
        const successState = resolveSuccessfulAccountSnapshotState<PersistedCanonicalAccountSnapshot>(
          normalized,
          nextCachedAt,
        );
        applySnapshot(normalized, {
          cachedAt: successState.cachedAt,
          fromCache: successState.isUsingCachedData,
        });
        void writeCachedSnapshot(normalized, nextCachedAt);
        recordClientEgressMetric('account_snapshot.fetch_completed', {
          reason: opts?.reason || refreshDecision.reason,
          responseBytes: Number(response.headers.get('X-DCAU-Snapshot-Bytes')) || null,
        });
        return normalized;
      } catch (error) {
        console.warn('[AccountSnapshotProvider] Failed to fetch account snapshot.', error);
        const fallbackCached = await readCachedSnapshot();
        const fallback = resolveFailedAccountSnapshotState({
          error,
          cachedSnapshot: fallbackCached.snapshot,
          cachedAt: fallbackCached.cachedAt,
          currentSnapshot: snapshotRef.current,
          currentCachedAt: cachedAtRef.current,
        });
        if (fallback.clearPersistedSnapshot) {
          clearPersistedAccountSnapshotSync(user.id);
          clearSnapshot();
          return null;
        }
        if (fallback.snapshot) {
          applySnapshot(fallback.snapshot, {
            cachedAt: fallback.cachedAt,
            fromCache: fallback.isUsingCachedData,
          });
          return fallback.snapshot;
        }
        setLoading(fallback.loading);
        setIsUsingCachedData(fallback.isUsingCachedData);
        setCachedAt(fallback.cachedAt);
        return null;
      }
    })();

    inflightFetchRef.current = requestPromise.finally(() => {
      inflightFetchRef.current = null;
    });

    return inflightFetchRef.current;
  }, [
    applySnapshot,
    clearSnapshot,
    isAuthLocked,
    isRestoringAuth,
    isOnline,
    readCachedSnapshot,
    session?.access_token,
    user?.id,
    writeCachedSnapshot,
  ]);

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (currentUserIdRef.current === nextUserId) return;
    currentUserIdRef.current = nextUserId;

    if (!nextUserId) {
      clearSnapshot();
      return;
    }

    const syncCached = readPersistedAccountSnapshotSync(nextUserId);
    if (syncCached.snapshot) {
      applySnapshot(syncCached.snapshot, { cachedAt: syncCached.cachedAt, fromCache: true });
      return;
    }

    setSnapshot(null);
    setIsUsingCachedData(false);
    setCachedAt(null);
    setLoading(true);
  }, [applySnapshot, clearSnapshot, user?.id]);

  useEffect(() => {
    if (shouldDeferBootstrap) {
      if (!snapshotRef.current) {
        setLoading(true);
      }
      return;
    }
    if (!user?.id) {
      clearSnapshot();
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      const cached = await readCachedSnapshot();
      if (cancelled) return;
      if (
        cached.snapshot &&
        (
          !snapshotRef.current ||
          (cached.cachedAt ?? 0) > (cachedAtRef.current ?? 0)
        )
      ) {
        applySnapshot(cached.snapshot, { cachedAt: cached.cachedAt, fromCache: true });
      } else if (!snapshotRef.current) {
        setLoading(true);
      }

      if (cancelled) return;
      await fetchSnapshot({
        silent: Boolean(cached.snapshot),
        reason: cached.snapshot ? 'bootstrap-cache-expiry' : 'bootstrap-cache-miss',
      });
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, clearSnapshot, fetchSnapshot, readCachedSnapshot, shouldDeferBootstrap, user?.id]);

  useEffect(() => {
    recordRealtimeChannelSnapshot('account-snapshot', supabase.getChannels());
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id) return undefined;

    const clearForUser = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null }>).detail;
      if (detail?.userId && detail.userId !== user.id) return;
      clearSnapshot();
    };

    const refreshForUser = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null; reason?: string | null }>).detail;
      if (detail?.userId && detail.userId !== user.id) return;
      clearPersistedAccountSnapshotSync(user.id);
      void fetchSnapshot({
        force: true,
        reason: detail?.reason || 'local-cache-invalidation',
      });
    };

    window.addEventListener('dcau:user-scoped-caches-cleared', clearForUser);
    window.addEventListener(ACCOUNT_SNAPSHOT_INVALIDATED_EVENT, refreshForUser);
    return () => {
      window.removeEventListener('dcau:user-scoped-caches-cleared', clearForUser);
      window.removeEventListener(ACCOUNT_SNAPSHOT_INVALIDATED_EVENT, refreshForUser);
    };
  }, [clearSnapshot, fetchSnapshot, user?.id]);

  const value = useMemo<AccountSnapshotContextValue>(() => ({
    snapshot,
    loading,
    isUsingCachedData,
    cachedAt,
    refresh: async () => fetchSnapshot({ force: true, reason: 'manual-refresh' }),
  }), [cachedAt, fetchSnapshot, isUsingCachedData, loading, snapshot]);

  return (
    <AccountSnapshotContext.Provider value={value}>
      {children}
    </AccountSnapshotContext.Provider>
  );
}

export function useAccountSnapshot() {
  return useContext(AccountSnapshotContext);
}

export function dispatchAccountSnapshotInvalidated(input?: {
  userId?: string | null;
  reason?: string | null;
}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACCOUNT_SNAPSHOT_INVALIDATED_EVENT, { detail: input || {} }));
}
