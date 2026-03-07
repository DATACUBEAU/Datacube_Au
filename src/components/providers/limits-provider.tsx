'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client/client';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import type { LimitExceededPayload } from '@/lib/limits/limit-errors';
import type { LimitsFlagsConfig } from '@/lib/limits/limitations-agent';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { safeFetch } from '@/lib/api/safe-fetch';

type UsageSnapshot = {
  plan: string;
  limits: Record<string, number>;
  usageToday: Record<string, number>;
  usageTotal: Record<string, number>;
  resetAt: string | null;
  usageWindows: Record<string, { label: string; reset_every_days: number; window_start: string; window_end: string | null }>;
  resetPolicies: Record<string, number>;
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
  usageWindows: {},
  resetPolicies: {},
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

function normalizeWindowMap(
  value: unknown,
): Record<string, { label: string; reset_every_days: number; window_start: string; window_end: string | null }> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    const entry = asRecord(raw);
    acc[key] = {
      label: typeof entry.label === 'string' ? entry.label : '',
      reset_every_days: asNumber(entry.reset_every_days),
      window_start: typeof entry.window_start === 'string' ? entry.window_start : '',
      window_end: typeof entry.window_end === 'string' ? entry.window_end : null,
    };
    return acc;
  }, {} as Record<string, { label: string; reset_every_days: number; window_start: string; window_end: string | null }>);
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
  const { isAuthLocked } = useSmartAuth();
  const [usage, setUsage] = useState<UsageSnapshot>(defaultUsage);
  const [serverLimitError, setServerLimitError] = useState<LimitExceededPayload | null>(null);
  const isFetchingRef = useRef(false);

  const flags = useMemo(() => readLimitsFlags(featureFlagRecords), [featureFlagRecords]);

  const fetchUsage = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id || !session?.access_token) {
      setUsage((prev) => ({ ...prev, loading: false }));
      return;
    }
    if (isAuthLocked) {
      setUsage((prev) => ({ ...prev, loading: false }));
      return;
    }
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;
    if (!opts?.silent) {
      setUsage((prev) => ({ ...prev, loading: true }));
    }

    try {
      const headers = new Headers();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
      const response = await safeFetch('/api/limits/effective', {
        method: 'GET',
        headers,
        credentials: 'include',
        timeout: 10_000,
        silent: true,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(String(data?.message || data?.error || `limits/effective failed (${response.status})`));
      }

      const usagePayload = asRecord(data.usage);
      setUsage({
        plan: typeof data.plan === 'string' ? data.plan : 'free',
        limits: normalizeNumberMap(data.limits),
        usageToday: normalizeNumberMap(usagePayload.today),
        usageTotal: normalizeNumberMap(usagePayload.total),
        usageWindows: normalizeWindowMap(usagePayload.windows),
        resetPolicies: normalizeNumberMap(usagePayload.reset_policies),
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
  }, [isAuthLocked, session?.access_token, user?.id]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!user?.id) {
      setUsage(defaultUsage);
      return;
    }
    if (isAuthLocked) {
      setUsage((prev) => ({ ...prev, loading: false }));
      return;
    }
    if (!isOnline) {
      setUsage((prev) => ({ ...prev, loading: false }));
      return;
    }
    void fetchUsage();
  }, [fetchUsage, isAuthLocked, isLoadingAuth, isOnline, user?.id]);

  useEffect(() => {
    if (!user?.id || !isOnline || isAuthLocked) return;

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
        { event: '*', schema: 'public', table: 'usage_totals', filter: `user_id=eq.${user.id}` },
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
        { event: '*', schema: 'public', table: 'au_user_entitlements', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_plan_transitions', filter: `user_id=eq.${user.id}` },
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_model_usage', filter: `user_id=eq.${user.id}` },
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
  }, [fetchUsage, isAuthLocked, isOnline, user?.id]);

  useEffect(() => {
    if (!user?.id || !session?.access_token || !isOnline || isAuthLocked) return;
    const timer = window.setInterval(() => {
      void fetchUsage({ silent: true });
    }, 20000);
    return () => window.clearInterval(timer);
  }, [fetchUsage, isAuthLocked, isOnline, session?.access_token, user?.id]);

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
