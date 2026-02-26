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
import { supabase } from '@/lib/supabase-client/client';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useSupabaseSession } from '@/hooks/use-supabase-auth';

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
};

const POLL_INTERVAL_MS = 45000;

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
    : {};

  return {
    id: String(row?.id || ''),
    key,
    enabled: row?.enabled === true,
    category: typeof row?.category === 'string' && row.category.trim()
      ? row.category.trim()
      : 'general',
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
  const flags: FeatureFlagsMap = { ...DEFAULT_FLAGS };

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
  const { isOnline } = useNetworkStatus();
  const { loading: isLoadingAuth } = useSupabaseSession();
  const isFetchingRef = useRef(false);

  const fetchFlags = useCallback(async (opts?: { silent?: boolean }) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!opts?.silent) setLoading(true);

    try {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('id,key,enabled,category,description,scope,org_id,user_id,config,updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        throw error;
      }

      const normalized = (data || [])
        .map((row) => normalizeFlagRow(row))
        .filter((row): row is FeatureFlagRecord => row !== null);

      setRows(normalized);
    } catch (error) {
      console.warn('[FeatureFlagProvider] Failed to fetch feature flags.', error);
      setRows((prev) => prev);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isLoadingAuth) return;
    void fetchFlags();
  }, [fetchFlags, isLoadingAuth]);

  useEffect(() => {
    if (isLoadingAuth || !isOnline) return;

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
  }, [fetchFlags, isLoadingAuth, isOnline]);

  useEffect(() => {
    if (isLoadingAuth || !isOnline) return;
    const timer = window.setInterval(() => {
      void fetchFlags({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchFlags, isLoadingAuth, isOnline]);

  const setFlag = useCallback(
    async (key: string, enabled: boolean, options?: SetFlagOptions) => {
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

      const { data, error } = await supabase.rpc('set_feature_flag', payload as any);
      if (error) {
        setRows(snapshot);
        throw error;
      }

      const record = normalizeFlagRow(data);
      if (record) {
        setRows((prev) => mergeRow(prev, record));
      } else {
        void fetchFlags({ silent: true });
      }
    },
    [fetchFlags, rows],
  );

  const refreshFlags = useCallback(async () => {
    await fetchFlags();
  }, [fetchFlags]);

  const value = useMemo<FeatureFlagContextType>(() => {
    const { flags, records } = rowsToState(rows);
    return {
      flags,
      records,
      isEnabled: (feature: string) => {
        if (flags[feature] === undefined) return true;
        return !!flags[feature];
      },
      loading,
      refreshFlags,
      setFlag,
    };
  }, [loading, refreshFlags, rows, setFlag]);

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
