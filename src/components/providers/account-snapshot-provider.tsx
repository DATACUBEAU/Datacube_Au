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
  resolveBootstrapAccountSnapshotState,
  resolveFailedAccountSnapshotState,
  resolveSuccessfulAccountSnapshotState,
  shouldDeferAccountSnapshotBootstrap,
} from '@/lib/account/account-snapshot-state';

type AccountSnapshotContextValue = {
  snapshot: PersistedCanonicalAccountSnapshot | null;
  loading: boolean;
  isUsingCachedData: boolean;
  cachedAt: number | null;
  refresh: () => Promise<PersistedCanonicalAccountSnapshot | null>;
};

const POLL_INTERVAL_MS = 20_000;

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
  const isFetchingRef = useRef(false);

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
    snapshotRef.current = next;
    cachedAtRef.current = options?.cachedAt ?? Date.now();
    setSnapshot(next);
    setLoading(false);
    setIsUsingCachedData(Boolean(options?.fromCache));
    setCachedAt(options?.cachedAt ?? Date.now());
  }, []);

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

  const fetchSnapshot = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id) {
      clearSnapshot();
      return null;
    }

    if (isAuthLocked || isRestoringAuth) {
      return snapshotRef.current;
    }

    if (isFetchingRef.current) {
      return snapshotRef.current;
    }

    if (!opts?.silent && !snapshotRef.current) {
      setLoading(true);
    }

    if (!session?.access_token || !isOnline) {
      const cached = await readCachedSnapshot();
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

    isFetchingRef.current = true;
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
        const requestError: Error & { status?: number } = new Error(
          String(
            (payload as any)?.message ||
            (payload as any)?.error ||
            `${ACCOUNT_SNAPSHOT_ROUTE} failed (${response.status})`,
          ),
        );
        requestError.status = response.status;
        throw requestError;
      }

      const nextCachedAt = Date.now();
      const successState = resolveSuccessfulAccountSnapshotState<PersistedCanonicalAccountSnapshot>(
        normalized,
        nextCachedAt,
      );
      applySnapshot(normalized, {
        cachedAt: successState.cachedAt,
        fromCache: successState.isUsingCachedData,
      });
      void writeCachedSnapshot(normalized, nextCachedAt);
      return normalized;
    } catch (error) {
      console.warn('[AccountSnapshotProvider] Failed to fetch account snapshot.', error);
      const cached = await readCachedSnapshot();
      const fallback = resolveFailedAccountSnapshotState({
        error,
        cachedSnapshot: cached.snapshot,
        cachedAt: cached.cachedAt,
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
    } finally {
      isFetchingRef.current = false;
    }
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
      await fetchSnapshot();
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, clearSnapshot, fetchSnapshot, readCachedSnapshot, shouldDeferBootstrap, user?.id]);

  useEffect(() => {
    if (!user?.id || !isOnline || isAuthLocked || isRestoringAuth) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimeout) return;
      refreshTimeout = setTimeout(() => {
        refreshTimeout = null;
        void fetchSnapshot({ silent: true });
      }, 150);
    };

    const channel = supabase
      .channel(`account-snapshot:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feature_flags' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_user_profiles', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entitlement_grants', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_plan_transitions', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'billing_subscriptions', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'billing_transactions', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_user_entitlements', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usage_counters', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usage_totals', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_plan_limit_rules' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_worker_jobs', filter: `owner_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_worker_jobs', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_documents', filter: `owner_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_documents', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_model_usage', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_messages', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'au_feature_outputs', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[AccountSnapshotProvider] realtime degraded; polling fallback remains active.');
        }
      });

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [fetchSnapshot, isAuthLocked, isOnline, isRestoringAuth, user?.id]);

  useEffect(() => {
    if (!user?.id || !session?.access_token || !isOnline || isAuthLocked || isRestoringAuth) return;
    const timer = window.setInterval(() => {
      void fetchSnapshot({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchSnapshot, isAuthLocked, isOnline, isRestoringAuth, session?.access_token, user?.id]);

  const value = useMemo<AccountSnapshotContextValue>(() => ({
    snapshot,
    loading,
    isUsingCachedData,
    cachedAt,
    refresh: async () => fetchSnapshot(),
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
