
'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase-client/client';

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

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>({});
  const [loading, setLoading] = useState(true);

  const fetchFlags = async () => {
    try {
      const { data, error } = await supabase
        .from('au_conex_config')
        .select('*')
        .single();
      
      if (error) {
        console.warn('[FeatureFlagProvider] Failed to fetch flags, using defaults.', error);
        // Default to enabled if fetch fails to avoid locking users out during errors
        setFlags({ global_chat_enabled: true });
      } else if (data) {
        setFlags(data);
      }
    } catch (err) {
      console.error('[FeatureFlagProvider] Error:', err);
      setFlags({ global_chat_enabled: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlags();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('conex-config-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'au_conex_config' },
        (payload) => {
          setFlags((prev) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
