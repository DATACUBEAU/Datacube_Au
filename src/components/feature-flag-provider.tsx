'use client';

import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { usePathname } from 'next/navigation';
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';
import { fetchAdmin } from '@/lib/api/admin-fetch';
import { safeFetch } from '@/lib/api/safe-fetch';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { dispatchSessionExpired } from '@/lib/auth/session-expiry-events';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import { useAccountSnapshot } from '@/components/providers/account-snapshot-provider';
import { buildSnapshotFallbackFlags } from '@/lib/feature-flags/client-fallback';

export type FeatureFlagScope = 'global' | 'org' | 'user';

export type FeatureFlagRecord = {
  id: string;
  key: string;
  enabled: boolean;
  category: string;
  description: string;
  scope: FeatureFlagScope;
  org_id: string | null;
  user_id: string | null;
  config: Record<string, unknown>;
  updated_at: string;
};

export type FeatureFlagsMap = Record<string, boolean>;
export type FeatureFlagsRecordMap = Record<string, FeatureFlagRecord>;

type SetFlagOptions = {
  category?: string;
  description?: string;
  scope?: FeatureFlagScope;
  config?: Record<string, unknown>;
};

interface FeatureFlagContextType {
  flags: FeatureFlagsMap;
  records: FeatureFlagsRecordMap;
  isEnabled: (feature: string) => boolean;
  loading: boolean;
  refreshFlags: () => Promise<void>;
  setFlag: (key: string, enabled: boolean, options?: SetFlagOptions) => Promise<void>;
}

const DEFAULT_FLAGS: FeatureFlagsMap = {
  global_chat_enabled: true,
  billing_enabled: false,
  promo_enabled: false,
  premium_models_enabled: false,
  premium_models_paid_only: false,
  paid_mode_enabled: false,
  stripe_live_mode: false,
};

const POLL_INTERVAL_MS = 45000;
const FLAG_CACHE_ROUTE = '/feature-flags';
const FLAG_CACHE_SOURCE = 'feature-flags-provider';
const FLAG_CACHE_SCHEMA = 1;
const FLAG_CACHE_TTL_MS = 1000 * 60 * 20;
const FAIL_CLOSED_FLAG_KEYS = new Set<string>([
  'billing_enabled',
  'promo_enabled',
  'premium_models_enabled',
  'premium_models_paid_only',
  'paid_mode_enabled',
  'stripe_live_mode',
]);

const FeatureFlagContext = createContext<FeatureFlagContextType>({
  flags: DEFAULT_FLAGS,
  records: {},
  isEnabled: () => true,
  loading: true,
  refreshFlags: async () => {},
  setFlag: async () => {},
});

function normalizeFlagRow(row: any): FeatureFlagRecord | null {
  const key = typeof row?.key === 'string' ? row.key.trim() : '';
  if (!key) return null;

  const scopeRaw = typeof row?.scope === 'string' ? row.scope.trim().toLowerCase() : 'global';
  const scope: FeatureFlagScope = scopeRaw === 'org' || scopeRaw === 'user' ? scopeRaw : 'global';

  const config = row?.config && typeof row.config === 'object' && !Array.isArray(row.config)
    ? row.config as Record<string, unknown>
    : (row?.value_json && typeof row.value_json === 'object' && !Array.isArray(row.value_json)
      ? row.value_json as Record<string, unknown>
      : {});

  return {
    id: String(row?.id || ''),
    key,
    enabled: row?.enabled === true || row?.is_enabled === true,
    category: typeof row?.category === 'string' && row.category.trim()
      ? row.category.trim()
      : 'billing',
    description: typeof row?.description === 'string' ? row.description : '',
    scope,
    org_id: typeof row?.org_id === 'string' ? row.org_id : null,
    user_id: typeof row?.user_id === 'string' ? row.user_id : null,
    config,
    updated_at: typeof row?.updated_at === 'string'
      ? row.updated_at
      : new Date().toISOString(),
  };
}

function rowsToState(rows: FeatureFlagRecord[]): { flags: FeatureFlagsMap; records: FeatureFlagsRecordMap } {
  const records: FeatureFlagsRecordMap = {};
  const flags: FeatureFlagsMap = {};

  for (const row of rows) {
    records[row.key] = row;
    flags[row.key] = row.enabled;
  }

  return { flags, records };
}

function mergeRow(prevRows: FeatureFlagRecord[], row: FeatureFlagRecord): FeatureFlagRecord[] {
  const next = prevRows.filter((item) => item.key !== row.key);
  next.push(row);
  return next;
}

function removeRow(prevRows: FeatureFlagRecord[], key: string): FeatureFlagRecord[] {
  return prevRows.filter((item) => item.key !== key);
}

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<FeatureFlagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const [user] = useSupabaseUser();
  const { isOnline } = useNetworkStatus();
  const { loading: isLoadingAuth } = useSupabaseSession();
  const { isAuthLocked } = useSmartAuth();
  const { snapshot: accountSnapshot } = useAccountSnapshot();
  const isFetchingRef = useRef(false);

  const readCachedRows = useCallback(async (): Promise<FeatureFlagRecord[] | null> => {
    if (!user?.id) return null;
    const cached = await readUserCache<{ rows: FeatureFlagRecord[] }>({
      userId: user.id,
      route: FLAG_CACHE_ROUTE,
      source: FLAG_CACHE_SOURCE,
      endpoint: 'list',
      schemaVersion: FLAG_CACHE_SCHEMA,
      maxAgeMs: FLAG_CACHE_TTL_MS,
    });
    const cachedRows = cached.data?.rows;
    if (!Array.isArray(cachedRows)) return null;
    return cachedRows
      .map((row) => normalizeFlagRow(row))
      .filter((row): row is FeatureFlagRecord => row !== null);
  }, [user?.id]);

  const writeCachedRows = useCallback(async (nextRows: FeatureFlagRecord[]) => {
    if (!user?.id) return;
    await writeUserCache({
      userId: user.id,
      route: FLAG_CACHE_ROUTE,
      source: FLAG_CACHE_SOURCE,
      endpoint: 'list',
      schemaVersion: FLAG_CACHE_SCHEMA,
      ttlMs: FLAG_CACHE_TTL_MS,
      data: { rows: nextRows },
    });
  }, [user?.id]);

  const fetchFlags = useCallback(async (opts?: { silent?: boolean }) => {
    if (isAuthLocked) {
      setLoading(false);
      return;
    }
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!opts?.silent) setLoading(true);

    try {
      if (!isOnline) {
        const cachedRows = await readCachedRows();
        if (cachedRows) {
          setRows(cachedRows);
        }
        setLoading(false);
        return;
      }

      const headers = new Headers();
      const accessToken = await getSupabaseAccessToken();
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }

      const res = await safeFetch('/api/feature-flags', {
        method: 'GET',
        headers,
        credentials: 'include',
        timeout: 15000,
        silent: true,
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const requestId =
          payload?.requestId ||
          payload?.request_id ||
          payload?.details?.requestId ||
          null;
        const reason =
          payload?.message ||
          payload?.error ||
          payload?.code ||
          `feature flag fetch failed (${res.status})`;
        throw new Error(requestId ? `${String(reason)} [requestId=${String(requestId)}]` : String(reason));
      }

      const sourceRows = Array.isArray(payload?.rows) ? payload.rows : [];

      const normalized = sourceRows
        .map((row: unknown) => normalizeFlagRow(row))
        .filter((row: FeatureFlagRecord | null): row is FeatureFlagRecord => row !== null);

      setRows(normalized);
      void writeCachedRows(normalized);
    } catch (error) {
      console.warn('[FeatureFlagProvider] Failed to fetch feature flags.', error);
      const cachedRows = await readCachedRows();
      if (cachedRows) {
        setRows(cachedRows);
      } else {
        setRows((prev) => prev);
      }
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [isAuthLocked, isOnline, readCachedRows, writeCachedRows]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (isAuthLocked) {
      setLoading(false);
      return;
    }
    void fetchFlags();
  }, [fetchFlags, isAuthLocked, isLoadingAuth]);

  useEffect(() => {
    if (!user?.id || !isAuthLocked || isLoadingAuth) return;
    setRows([]);
  }, [isAuthLocked, isLoadingAuth, user?.id]);

  useEffect(() => {
    if (isLoadingAuth || !isOnline || isAuthLocked) return;

    const channel = supabase
      .channel('feature-flags-v2')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_flags' },
        (payload: any) => {
          const incoming = normalizeFlagRow(payload?.new ?? payload?.old);
          if (!incoming) {
            void fetchFlags({ silent: true });
            return;
          }

          setRows((prev) => {
            if (payload?.eventType === 'DELETE') {
              return removeRow(prev, incoming.key);
            }
            return mergeRow(prev, incoming);
          });
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[FeatureFlagProvider] Realtime channel degraded, relying on polling fallback.');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchFlags, isAuthLocked, isLoadingAuth, isOnline]);

  useEffect(() => {
    if (isLoadingAuth || !isOnline || isAuthLocked) return;
    const timer = window.setInterval(() => {
      void fetchFlags({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchFlags, isAuthLocked, isLoadingAuth, isOnline]);

  const setFlag = useCallback(
    async (key: string, enabled: boolean, options?: SetFlagOptions) => {
      if (isAuthLocked) {
        throw new Error('Session expired. Please sign in again.');
      }
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) throw new Error('Flag key is required.');

      const snapshot = rows;
      const existing = rows.find((row) => row.key === normalizedKey);

      const optimisticRow: FeatureFlagRecord = {
        id: existing?.id || `optimistic-${normalizedKey}`,
        key: normalizedKey,
        enabled,
        category: options?.category || existing?.category || 'general',
        description: options?.description || existing?.description || '',
        scope: options?.scope || existing?.scope || 'global',
        org_id: existing?.org_id || null,
        user_id: existing?.user_id || null,
        config: options?.config || existing?.config || {},
        updated_at: new Date().toISOString(),
      };

      setRows((prev) => mergeRow(prev, optimisticRow));

      const payload = {
        p_key: normalizedKey,
        p_enabled: enabled,
        p_category: optimisticRow.category,
        p_description: optimisticRow.description,
        p_scope: optimisticRow.scope,
        p_config: optimisticRow.config,
      };

      const adminToken = typeof window !== 'undefined'
        ? window.localStorage.getItem('conex_admin_token')
        : null;
      const inConexContext = Boolean(adminToken) || pathname?.startsWith('/conex');

      const parseAdminPayload = async (res: any): Promise<any> => {
        if (res?.data && typeof res.data === 'object') return res.data;
        return await res.clone().json().catch(() => null);
      };

      const buildErrorMessage = (
        fallbackLabel: string,
        payloadObj: any,
        status: number,
      ): string => {
        const message =
          payloadObj?.error ||
          payloadObj?.message ||
          payloadObj?.code ||
          `${fallbackLabel} (${status})`;
        const requestId =
          payloadObj?.requestId ||
          payloadObj?.request_id ||
          payloadObj?.correlation_id ||
          payloadObj?.details?.requestId ||
          null;
        return requestId ? `${String(message)} [requestId=${String(requestId)}]` : String(message);
      };

      const runLocalApiUpdate = async (): Promise<any> => {
        const accessToken = await getSupabaseAccessToken();
        const headers = new Headers({ 'Content-Type': 'application/json' });
        if (accessToken) {
          headers.set('Authorization', `Bearer ${accessToken}`);
        }

        const res = await fetch('/api/admin/feature-flags', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            key: normalizedKey,
            enabled,
            category: optimisticRow.category,
            description: optimisticRow.description,
            scope: optimisticRow.scope,
            config: optimisticRow.config,
          }),
        });

        const payload = await res.clone().json().catch(() => null);
        if (!res.ok) {
          throw new Error(buildErrorMessage('feature-flag API update failed', payload, res.status));
        }

        return payload?.flag ?? payload?.data?.flag ?? payload;
      };

      const runAdminHandlerUpdate = async (): Promise<any> => {
        const res = await fetchAdmin('admin-handler', {
          method: 'POST',
          body: JSON.stringify({
            action: 'update_feature_flag',
            key: normalizedKey,
            enabled,
          }),
        });
        const payload = await parseAdminPayload(res as any);
        if (!res.ok) {
          throw new Error(buildErrorMessage('admin-handler update_feature_flag failed', payload, res.status));
        }
        return payload?.flag ?? payload?.data?.flag ?? payload;
      };

      const runAdminHandlerWithRefreshRetry = async (): Promise<any> => {
        try {
          return await runAdminHandlerUpdate();
        } catch (firstErr) {
          const firstMessage = String((firstErr as any)?.message || '');
          const shouldRetryAuth =
            firstMessage.toLowerCase().includes('unauthorized') ||
            firstMessage.toLowerCase().includes('invalid_token') ||
            firstMessage.toLowerCase().includes('expired');
          if (!shouldRetryAuth) throw firstErr;

          await supabase.auth.getSession();
          await supabase.auth.refreshSession().catch(() => null);
          return await runAdminHandlerUpdate();
        }
      };

      let data: any = null;
      const attemptErrors: string[] = [];
      const attempts: Array<{ name: string; run: () => Promise<any> }> = [
        // Prefer stable local API first to avoid surfacing transient admin-handler 500s in UI.
        { name: 'api/admin/feature-flags', run: runLocalApiUpdate },
        ...((inConexContext || adminToken)
          ? [{ name: 'admin-handler', run: runAdminHandlerWithRefreshRetry }]
          : []),
      ];

      attempts.push({
        name: 'rpc:set_feature_flag',
        run: async () => {
          const rpcResult = await supabase.rpc('set_feature_flag', payload as any);
          if (rpcResult.error) {
            throw new Error(String(rpcResult.error.message || 'set_feature_flag RPC failed'));
          }
          return rpcResult.data;
        },
      });

      for (const attempt of attempts) {
        try {
          data = await attempt.run();
          if (data) break;
        } catch (err: any) {
          attemptErrors.push(`[${attempt.name}] ${String(err?.message || err)}`);
        }
      }

      if (!data) {
        const joined = attemptErrors.join(' | ') || 'Failed to update feature flag.';
        const authError = attemptErrors.some((entry) => {
          const lower = entry.toLowerCase();
          return lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid token');
        });
        if (authError) {
          dispatchSessionExpired({
            status: 401,
            source: 'FeatureFlagProvider.setFlag',
            reason: 'admin_flag_update_auth_error',
          });
          setRows(snapshot);
          throw new Error('Session expired. Please sign in again and retry.');
        }
        setRows(snapshot);
        throw new Error(joined);
      }

      const record = normalizeFlagRow(data);
      if (record) {
        setRows((prev) => mergeRow(prev, record));
      } else {
        void fetchFlags({ silent: true });
      }
    },
    [fetchFlags, isAuthLocked, pathname, rows],
  );

  const refreshFlags = useCallback(async () => {
    await fetchFlags();
  }, [fetchFlags]);

  const value = useMemo<FeatureFlagContextType>(() => {
    const { flags: rawFlags, records } = rowsToState(rows);
    const fallbackFlags = buildSnapshotFallbackFlags(accountSnapshot);
    const flags: FeatureFlagsMap = {
      ...DEFAULT_FLAGS,
      ...fallbackFlags,
      ...rawFlags,
    };
    return {
      flags,
      records,
      isEnabled: (feature: string) => {
        if (flags[feature] === undefined) return !FAIL_CLOSED_FLAG_KEYS.has(feature);
        return !!flags[feature];
      },
      loading,
      refreshFlags,
      setFlag,
    };
  }, [accountSnapshot, loading, refreshFlags, rows, setFlag]);

  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagContext);
}

export function useFlag(feature: string) {
  const { isEnabled, loading } = useFeatureFlags();
  return {
    enabled: isEnabled(feature),
    loading,
  };
}

// Backward-compatible alias used in existing pages.
export function useFeatureFlag(feature: string) {
  return useFlag(feature);
}
