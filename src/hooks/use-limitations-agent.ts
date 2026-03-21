'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useLimits } from '@/components/providers/limits-provider';
import { buildLimitationsAlerts, type LimitAlert } from '@/lib/limits/limitations-agent';
import { extractLimitExceededPayload, type LimitExceededPayload } from '@/lib/limits/limit-errors';

type AgentContext = {
  route: 'upload' | 'chat' | 'ingestion' | 'dashboard' | string;
  pendingFileSizeMb?: number | null;
  expectedPages?: number | null;
  expectedChunks?: number | null;
  activeJobsCount?: number | null;
  totalDocsCount?: number | null;
  totalStorageMb?: number | null;
};

type UseLimitationsAgentResult = {
  loading: boolean;
  plan: string;
  alerts: LimitAlert[];
  primaryAlert: LimitAlert | null;
  toastCandidate: LimitAlert | null;
  resetAt: string | null;
  reportLimitError: (errorLike: unknown) => void;
  reportLimitPayload: (payload: LimitExceededPayload | null) => void;
  clearLimitError: () => void;
  markToastShown: (alert: LimitAlert) => void;
  dismissAlert: (alertId: string) => void;
};

function cooldownKey(userId: string, alertId: string): string {
  return `dcau:limits:cooldown:${userId}:${alertId}`;
}

function isInCooldown(userId: string, alertId: string, cooldownMinutes: number): boolean {
  if (typeof window === 'undefined') return false;
  const key = cooldownKey(userId, alertId);
  const raw = window.localStorage.getItem(key);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  const elapsedMs = Date.now() - ts;
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

function toInformational(alert: LimitAlert): LimitAlert {
  if (alert.severity === 'block') return alert;
  return {
    ...alert,
    severity: 'info',
    cta: undefined,
    dismissible: true,
  };
}

export function useLimitationsAgent(context: AgentContext): UseLimitationsAgentResult {
  const [user] = useSupabaseUser();
  const userId = user?.id ?? null;
  const {
    usage,
    flags,
    serverLimitError,
    reportServerLimitError,
    clearServerLimitError,
  } = useLimits();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const alerts = useMemo(() => {
    const raw = buildLimitationsAlerts({
      route: context.route,
      plan: usage.plan,
      limits: usage.limits,
      usageToday: usage.usageToday,
      usageTotal: usage.usageTotal,
      resetAt: usage.resetAt,
      flags,
      context: {
        pendingFileSizeMb: context.pendingFileSizeMb,
        expectedPages: context.expectedPages,
        expectedChunks: context.expectedChunks,
        activeJobsCount: context.activeJobsCount,
        totalDocsCount: context.totalDocsCount,
        totalStorageMb: context.totalStorageMb,
      },
      serverLimitError,
    });

    const isFree = String(usage.plan || '').toLowerCase() === 'free';
    const visible = raw
      .filter((alert) => !dismissedIds.has(alert.id))
      .map((alert) => (isFree ? alert : toInformational(alert)));

    return visible;
  }, [
    context.activeJobsCount,
    context.expectedChunks,
    context.expectedPages,
    context.pendingFileSizeMb,
    context.route,
    context.totalDocsCount,
    context.totalStorageMb,
    dismissedIds,
    flags,
    serverLimitError,
    usage.limits,
    usage.plan,
    usage.resetAt,
    usage.usageToday,
    usage.usageTotal,
  ]);

  const primaryAlert = alerts.length > 0 ? alerts[0] : null;

  const toastCandidate = useMemo(() => {
    if (!userId) return null;
    for (const alert of alerts) {
      if (alert.severity === 'info') continue;
      if (!isInCooldown(userId, alert.id, flags.cooldownMinutes)) {
        return alert;
      }
    }
    return null;
  }, [alerts, flags.cooldownMinutes, userId]);

  const reportLimitError = useCallback((errorLike: unknown) => {
    const payload = extractLimitExceededPayload(errorLike);
    if (!payload) return;
    reportServerLimitError(payload);
  }, [reportServerLimitError]);

  const markToastShown = useCallback((alert: LimitAlert) => {
    if (!userId || typeof window === 'undefined') return;
    const key = cooldownKey(userId, alert.id);
    window.localStorage.setItem(key, String(Date.now()));
  }, [userId]);

  const dismissAlert = useCallback((alertId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(alertId);
      return next;
    });
  }, []);

  return {
    loading: usage.loading,
    plan: usage.plan,
    alerts,
    primaryAlert,
    toastCandidate,
    resetAt: usage.resetAt,
    reportLimitError,
    reportLimitPayload: reportServerLimitError,
    clearLimitError: clearServerLimitError,
    markToastShown,
    dismissAlert,
  };
}
