'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import { useAccountSnapshot } from '@/components/providers/account-snapshot-provider';
import type { LimitExceededPayload } from '@/lib/limits/limit-errors';
import type { LimitsFlagsConfig } from '@/lib/limits/limitations-agent';

type UsageSnapshot = {
  plan: string;
  limits: Record<string, number>;
  limitRules: Record<string, Record<string, unknown>>;
  usageByLimit: Record<string, Record<string, unknown>>;
  usageToday: Record<string, number>;
  usageTotal: Record<string, number>;
  resetAt: string | null;
  usageWindows: Record<string, {
    label: string;
    policy: string;
    interval_value: number | null;
    interval_unit: string | null;
    window_start: string;
    window_end: string | null;
  }>;
  resetPolicies: Record<string, string>;
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
  plan: 'unknown',
  limits: {},
  limitRules: {},
  usageByLimit: {},
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
): Record<string, {
  label: string;
  policy: string;
  interval_value: number | null;
  interval_unit: string | null;
  window_start: string;
  window_end: string | null;
}> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    const entry = asRecord(raw);
    acc[key] = {
      label: typeof entry.label === 'string' ? entry.label : '',
      policy: typeof entry.policy === 'string' ? entry.policy : '',
      interval_value: Number.isFinite(Number(entry.intervalValue ?? entry.interval_value))
        ? Number(entry.intervalValue ?? entry.interval_value)
        : null,
      interval_unit:
        typeof entry.intervalUnit === 'string'
          ? entry.intervalUnit
          : (typeof entry.interval_unit === 'string' ? entry.interval_unit : null),
      window_start: typeof entry.window_start === 'string' ? entry.window_start : '',
      window_end: typeof entry.window_end === 'string' ? entry.window_end : null,
    };
    return acc;
  }, {} as Record<string, {
    label: string;
    policy: string;
    interval_value: number | null;
    interval_unit: string | null;
    window_start: string;
    window_end: string | null;
  }>);
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    if (typeof raw === 'string') {
      acc[key] = raw;
    }
    return acc;
  }, {} as Record<string, string>);
}

function normalizeObjectMap(value: unknown): Record<string, Record<string, unknown>> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    acc[key] = asRecord(raw);
    return acc;
  }, {} as Record<string, Record<string, unknown>>);
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
  const { records: featureFlagRecords } = useFeatureFlags();
  const { snapshot, loading: snapshotLoading, refresh } = useAccountSnapshot();
  const [serverLimitError, setServerLimitError] = useState<LimitExceededPayload | null>(null);

  const flags = useMemo(() => readLimitsFlags(featureFlagRecords), [featureFlagRecords]);
  const usage = useMemo<UsageSnapshot>(() => {
    if (!snapshot) {
      return {
        ...defaultUsage,
        loading: snapshotLoading,
      };
    }

    return {
      plan:
        typeof snapshot.effectivePlan?.plan === 'string'
          ? snapshot.effectivePlan.plan
          : (typeof snapshot.plan === 'string' ? snapshot.plan : 'unknown'),
      limits: normalizeNumberMap(snapshot.limits),
      limitRules: normalizeObjectMap(snapshot.limitRules),
      usageByLimit: normalizeObjectMap(snapshot.usage.byLimit),
      usageToday: normalizeNumberMap(snapshot.usage.today),
      usageTotal: normalizeNumberMap(snapshot.usage.total),
      usageWindows: normalizeWindowMap(snapshot.usage.windows),
      resetPolicies: normalizeStringMap(snapshot.usage.resetPolicies),
      resetAt: typeof snapshot.usage.resetAt === 'string' ? snapshot.usage.resetAt : null,
      loading: false,
      fetchedAt:
        typeof snapshot.validatedAt === 'string'
          ? (Date.parse(snapshot.validatedAt) || Date.now())
          : Date.now(),
    };
  }, [snapshot, snapshotLoading]);

  const value = useMemo<LimitsContextValue>(() => ({
    usage,
    flags,
    refreshUsage: async () => {
      await refresh();
    },
    reportServerLimitError: (payload: LimitExceededPayload | null) => {
      setServerLimitError(payload);
    },
    clearServerLimitError: () => setServerLimitError(null),
    serverLimitError,
  }), [flags, refresh, serverLimitError, usage]);

  return (
    <LimitsContext.Provider value={value}>
      {children}
    </LimitsContext.Provider>
  );
}

export function useLimits() {
  return useContext(LimitsContext);
}
