
'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase-client/client';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useSupabaseSession } from '@/hooks/use-supabase-auth';

interface FeatureFlags {
  global_chat_enabled?: boolean;
  [key: string]: any;
}

interface FeatureFlagContextType {
  flags: FeatureFlags;
  isEnabled: (feature: string) => boolean;
  loading: boolean;
  refreshFlags: () => Promise<void>;
}

const FeatureFlagContext = createContext<FeatureFlagContextType>({
  flags: {},
  isEnabled: () => false,
  loading: true,
  refreshFlags: async () => {},
});

let hasWarnedFeatureFlagFetch = false;
let hasWarnedFeatureFlagRealtime = false;
const DEFAULT_FLAGS: FeatureFlags = { global_chat_enabled: true };
const POLL_INTERVAL_MS = 45000;
const CONEX_FLAG_COLUMNS = 'global_chat_enabled,premium_models_enabled,premium_models_paid_only,billing_enabled,paid_mode_enabled,free_pressure_mode_enabled,stripe_live_mode';

function extractConexFlags(value: any): FeatureFlags {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return {
    global_chat_enabled: value.global_chat_enabled,
    premium_models_enabled: value.premium_models_enabled,
    premium_models_paid_only: value.premium_models_paid_only,
    billing_enabled: value.billing_enabled,
    paid_mode_enabled: value.paid_mode_enabled,
    free_pressure_mode_enabled: value.free_pressure_mode_enabled,
    stripe_live_mode: value.stripe_live_mode,
  };
}

function mapFlagRows(rows: Array<{ key?: unknown; is_enabled?: unknown }> | null | undefined): FeatureFlags {
  const mapped: FeatureFlags = {};
  for (const row of rows || []) {
    const key = typeof row?.key === 'string' ? row.key.trim() : '';
    if (!key) continue;
    mapped[key] = row.is_enabled === true;
  }
  return mapped;
}

function mergeFlagState(conexConfig: FeatureFlags | null | undefined, tableFlags: FeatureFlags | null | undefined): FeatureFlags {
  return {
    ...DEFAULT_FLAGS,
    ...(conexConfig || {}),
    ...(tableFlags || {}),
  };
}

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const { isOnline } = useNetworkStatus();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const isFetchingRef = useRef(false);

  const fetchFlags = useCallback(async (opts?: { silent?: boolean }) => {
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    if (!opts?.silent) {
      setLoading(true);
    }

    if (!isOnline || !session?.access_token) {
      setFlags((prev) => (Object.keys(prev).length > 0 ? prev : DEFAULT_FLAGS));
      setLoading(false);
      isFetchingRef.current = false;
      return;
    }

    try {
      const [{ data: conexConfig, error: conexError }, { data: featureRows, error: flagError }] = await Promise.all([
        supabase
          .from('au_conex_config')
          .select(CONEX_FLAG_COLUMNS)
          .eq('id', 1)
          .maybeSingle(),
        supabase
          .from('au_feature_flags')
          .select('key,is_enabled'),
      ]);

      if (conexError || flagError) {
        if (!hasWarnedFeatureFlagFetch) {
          console.warn('[FeatureFlagProvider] Partial flag fetch failure; keeping defaults/fallback values.', {
            conexError: conexError?.message,
            featureFlagError: flagError?.message,
          });
          hasWarnedFeatureFlagFetch = true;
        }
      }

      const merged = mergeFlagState(extractConexFlags(conexConfig), mapFlagRows(featureRows as any[]));
      setFlags(merged);
    } catch (err) {
      if (!hasWarnedFeatureFlagFetch) {
        console.warn('[FeatureFlagProvider] Error loading flags, using defaults.', err);
        hasWarnedFeatureFlagFetch = true;
      }
      setFlags((prev) => (Object.keys(prev).length > 0 ? prev : DEFAULT_FLAGS));
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [isOnline, session?.access_token]);

  useEffect(() => {
    if (isLoadingAuth) {
      return;
    }

    void fetchFlags();

    if (!isOnline || !session?.access_token) {
      return;
    }

    const channel = supabase
      .channel('feature-flag-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_conex_config', filter: 'id=eq.1' },
        (payload: any) => {
          const nextConex = extractConexFlags(payload?.new);
          if (Object.keys(nextConex).length === 0) {
            void fetchFlags({ silent: true });
            return;
          }
          setFlags((prev) => mergeFlagState({ ...prev, ...nextConex }, null));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_feature_flags' },
        (payload: any) => {
          const row = (payload?.new ?? payload?.old) as { key?: unknown; is_enabled?: unknown } | undefined;
          const key = typeof row?.key === 'string' ? row.key.trim() : '';
          if (!key) {
            return;
          }

          setFlags((prev) => {
            const next = { ...prev };
            if (payload?.eventType === 'DELETE') {
              delete next[key];
            } else {
              next[key] = row?.is_enabled === true;
            }
            return mergeFlagState(next, null);
          });
        }
      )
      .subscribe((status) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !hasWarnedFeatureFlagRealtime) {
          console.warn('[FeatureFlagProvider] Realtime unavailable; switching to polling fallback.');
          hasWarnedFeatureFlagRealtime = true;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchFlags, isLoadingAuth, isOnline, session?.access_token]);

  useEffect(() => {
    if (isLoadingAuth || !isOnline || !session?.access_token) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchFlags({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchFlags, isLoadingAuth, isOnline, session?.access_token]);

  const refreshFlags = useCallback(async () => {
    await fetchFlags();
  }, [fetchFlags]);

  const value = useMemo(() => ({
    flags,
    isEnabled: (feature: string) => {
        // If flag is undefined, default to true for backward compatibility unless specified otherwise
        if (flags[feature] === undefined) return true;
        return !!flags[feature];
    },
    loading,
    refreshFlags,
  }), [flags, loading, refreshFlags]);

  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlag(feature: string) {
  const { isEnabled, loading } = useContext(FeatureFlagContext);
  return { enabled: isEnabled(feature), loading };
}
