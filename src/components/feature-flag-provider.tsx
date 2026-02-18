
'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useMemo, useCallback } from 'react';
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

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>({});
  const [loading, setLoading] = useState(true);
  const { isOnline } = useNetworkStatus();
  const { session, loading: isLoadingAuth } = useSupabaseSession();

  const fetchFlags = useCallback(async () => {
    if (!isOnline || !session?.access_token) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('au_conex_config')
        .select('*')
        .single();
      
      if (error) {
        if (!hasWarnedFeatureFlagFetch) {
          console.warn('[FeatureFlagProvider] Failed to fetch flags, using defaults.', error);
          hasWarnedFeatureFlagFetch = true;
        }
        setFlags({ global_chat_enabled: true });
      } else if (data) {
        setFlags(data);
      }
    } catch (err) {
      if (!hasWarnedFeatureFlagFetch) {
        console.warn('[FeatureFlagProvider] Error loading flags, using defaults.', err);
        hasWarnedFeatureFlagFetch = true;
      }
      setFlags({ global_chat_enabled: true });
    } finally {
      setLoading(false);
    }
  }, [isOnline, session?.access_token]);

  useEffect(() => {
    if (isLoadingAuth) {
      return;
    }

    setLoading(true);
    fetchFlags();

    if (!isOnline || !session?.access_token) {
      return;
    }

    const channel = supabase
      .channel('conex-config-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'au_conex_config' },
        (payload) => {
          setFlags((prev) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe((status) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !hasWarnedFeatureFlagRealtime) {
          console.warn('[FeatureFlagProvider] Realtime unavailable; continuing with cached/default flags.');
          hasWarnedFeatureFlagRealtime = true;
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchFlags, isLoadingAuth, isOnline, session?.access_token]);

  const value = useMemo(() => ({
    flags,
    isEnabled: (feature: string) => {
        // If flag is undefined, default to true for backward compatibility unless specified otherwise
        if (flags[feature] === undefined) return true;
        return !!flags[feature];
    },
    loading,
    refreshFlags: fetchFlags,
  }), [flags, loading]);

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
