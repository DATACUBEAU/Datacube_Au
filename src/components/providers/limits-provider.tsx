'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { invokeEdgeFunction, supabase } from '@/lib/supabase-client/client';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import type { LimitExceededPayload } from '@/lib/limits/limit-errors';
import type { LimitsFlagsConfig } from '@/lib/limits/limitations-agent';

type UsageSnapshot = {
  plan: string;
  limits: Record<string, number>;
  usageToday: Record<string, number>;
  usageTotal: Record<string, number>;
  resetAt: string | null;
  loading: boolean;
  fetchedAt: number | null;
};

type LimitsContextValue = {
  usage: UsageSnapshot;
  flags: LimitsFlagsConfig;
  refreshUsage: () => Promise<void>;
  reportServerLimitError: (payload: LimitExceededPayload | null) => void;
  clearServerLimitError: () => void;
  serverLimitError: LimitExceededPayload | null;
};

const defaultFlags: LimitsFlagsConfig = {
  alertsEnabled: true,
  thresholds: { warn: [70, 90], block: [100] },
  cooldownMinutes: 20,
  enforcementEnabled: true,
  upsellEnabled: true,
};

const defaultUsage: UsageSnapshot = {
  plan: 'free',
  limits: {},
  usageToday: {},
  usageTotal: {},
  resetAt: null,
  loading: true,
  fetchedAt: null,
};

const LimitsContext = createContext<LimitsContextValue>({
  usage: defaultUsage,
  flags: defaultFlags,
  refreshUsage: async () => {},
  reportServerLimitError: () => {},
  clearServerLimitError: () => {},
  serverLimitError: null,
});

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) acc[key] = parsed;
    return acc;
  }, {} as Record<string, number>);
}

function normalizeThresholdArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((entry) => asNumber(entry))
    .filter((entry) => entry > 0 && entry <= 100)
    .sort((a, b) => a - b);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

function readLimitsFlags(records: Record<string, any>): LimitsFlagsConfig {
  const alertsEnabled = records['limits.alerts.enabled']?.enabled !== false;
  const thresholdsConfig = asRecord(records['limits.alerts.thresholds']?.config);
  const cooldownConfig = asRecord(records['limits.alerts.cooldown_minutes']?.config);
  const warn = normalizeThresholdArray(thresholdsConfig.warn, [70, 90]);
  const block = normalizeThresholdArray(thresholdsConfig.block, [100]);
  const cooldownMinutes = Math.max(1, Math.floor(asNumber(cooldownConfig.minutes, 20)));

  return {
    alertsEnabled,
    thresholds: { warn, block },
    cooldownMinutes,
    enforcementEnabled: records['limits.enforcement.enabled']?.enabled !== false,
    upsellEnabled: records['limits.ui.upsell.enabled']?.enabled !== false,
  };
}

export function LimitsProvider({ children }: { children: React.ReactNode }) {
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { isOnline } = useNetworkStatus();
  const { records: featureFlagRecords } = useFeatureFlags();
  const [usage, setUsage] = useState<UsageSnapshot>(defaultUsage);
  const [serverLimitError, setServerLimitError] = useState<LimitExceededPayload | null>(null);
  const isFetchingRef = useRef(false);

  const flags = useMemo(() => readLimitsFlags(featureFlagRecords), [featureFlagRecords]);

  const fetchUsage = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id || !session?.access_token) {
      setUsage((prev) => ({ ...prev, loading: false }));
      return;
    }
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;
    if (!opts?.silent) {
      setUsage((prev) => ({ ...prev, loading: true }));
    }

    try {
      const { data, error } = await invokeEdgeFunction<any>('usage-status', {
        method: 'GET',
        requireAuth: true,
        silent: true,
      });
      if (error || !data) {
        throw error || new Error('usage-status returned empty payload');
      }

      const usagePayload = asRecord(data.usage);
      setUsage({
        plan: typeof data.plan === 'string' ? data.plan : 'free',
        limits: normalizeNumberMap(data.limits),
        usageToday: normalizeNumberMap(usagePayload.today),
        usageTotal: normalizeNumberMap(usagePayload.total),
        resetAt: typeof data.reset_at === 'string'
          ? data.reset_at
          : (typeof usagePayload.reset_at === 'string' ? usagePayload.reset_at : null),
        loading: false,
        fetchedAt: Date.now(),
      });
    } catch (error) {
      console.warn('[LimitsProvider] Failed to fetch usage status', error);
      setUsage((prev) => ({ ...prev, loading: false }));
    } finally {
      isFetchingRef.current = false;
    }
  }, [session?.access_token, user?.id]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!user?.id) {
      setUsage(defaultUsage);
      return;
    }
    if (!isOnline) {
      setUsage((prev) => ({ ...prev, loading: false }));
      return;
    }
    void fetchUsage();
  }, [fetchUsage, isLoadingAuth, isOnline, user?.id]);

  useEffect(() => {
    if (!user?.id || !isOnline) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimeout) return;
      refreshTimeout = setTimeout(() => {
        refreshTimeout = null;
        void fetchUsage({ silent: true });
      }, 120);
    };

    const channel = supabase
      .channel(`limits-state:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'usage_counters', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_user_profiles', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_worker_jobs', filter: `owner_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_worker_jobs', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_documents', filter: `owner_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_documents', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[LimitsProvider] realtime degraded; polling fallback remains active.');
        }
      });

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [fetchUsage, isOnline, user?.id]);

  useEffect(() => {
    if (!user?.id || !session?.access_token || !isOnline) return;
    const timer = window.setInterval(() => {
      void fetchUsage({ silent: true });
    }, 20000);
    return () => window.clearInterval(timer);
  }, [fetchUsage, isOnline, session?.access_token, user?.id]);

  const value = useMemo<LimitsContextValue>(() => ({
    usage,
    flags,
    refreshUsage: async () => {
      await fetchUsage();
    },
    reportServerLimitError: (payload: LimitExceededPayload | null) => {
      setServerLimitError(payload);
    },
    clearServerLimitError: () => setServerLimitError(null),
    serverLimitError,
  }), [fetchUsage, flags, serverLimitError, usage]);

  return (
    <LimitsContext.Provider value={value}>
      {children}
    </LimitsContext.Provider>
  );
}

export function useLimits() {
  return useContext(LimitsContext);
}
