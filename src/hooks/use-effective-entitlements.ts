'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  normalizeBillingEntitlementSource,
  normalizeEffectiveEntitlementPlan,
} from '@/lib/billing/plans';
import { safeFetch } from '@/lib/api/safe-fetch';
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { supabase } from '@/lib/supabase-client/client';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { FREE_PLAN_EXPIRATION_DAYS } from '@/lib/plans/subscription-policy';

export type EffectiveEntitlements = {
  userId: string | null;
  plan: 'free' | 'pro' | 'promo_pro' | 'premium' | 'admin';
  hasPro: boolean;
  entitlementSource: 'paid' | 'promo' | 'none';
  entitlementEndsAt: string | null;
  billingEnabled: boolean;
  promoEnabled: boolean;
  promoActive: boolean;
  canAccessBilling: boolean;
  promoBannerEnabled: boolean;
  promoContentConfig: Record<string, unknown>;
  promoEndsAtUtc: string | null;
  promoEndsAtLagos: string | null;
  retentionDays: number;
  asOf: string | null;
  source: string;
};

const ENTITLEMENTS_CACHE_ROUTE = '/entitlements/effective';
const ENTITLEMENTS_CACHE_SOURCE = 'effective-entitlements';
const ENTITLEMENTS_CACHE_SCHEMA = 1;
const ENTITLEMENTS_CACHE_TTL_MS = 1000 * 60 * 15;
const POLL_INTERVAL_MS = 45_000;

const FAIL_CLOSED_ENTITLEMENTS: EffectiveEntitlements = {
  userId: null,
  plan: 'free',
  hasPro: false,
  entitlementSource: 'none',
  entitlementEndsAt: null,
  billingEnabled: false,
  promoEnabled: false,
  promoActive: false,
  canAccessBilling: false,
  promoBannerEnabled: false,
  promoContentConfig: {},
  promoEndsAtUtc: null,
  promoEndsAtLagos: null,
  retentionDays: FREE_PLAN_EXPIRATION_DAYS,
  asOf: null,
  source: 'fail_closed',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizePlan(raw: unknown): EffectiveEntitlements['plan'] {
  return normalizeEffectiveEntitlementPlan(raw);
}

function normalizeSource(raw: unknown): EffectiveEntitlements['entitlementSource'] {
  return normalizeBillingEntitlementSource(raw);
}

function normalizeEntitlements(payload: unknown, fallbackUserId: string | null): EffectiveEntitlements {
  const row = asRecord(payload);
  const normalizedSource = normalizeSource(row.entitlementSource);
  const normalizedPlan = normalizePlan(row.plan);
  const promoActive = row.promoActive === true;
  const isAdminPlan = normalizedPlan === 'admin';
  const isPremiumPlan = normalizedPlan === 'premium';
  const hasPaidEntitlement = normalizedSource === 'paid';
  const hasPromoEntitlement = normalizedSource === 'promo' || promoActive;
  const effectiveHasPro = isAdminPlan || isPremiumPlan || hasPaidEntitlement || hasPromoEntitlement;
  const effectivePlan: EffectiveEntitlements['plan'] = isAdminPlan
    ? 'admin'
    : isPremiumPlan
      ? 'premium'
    : hasPromoEntitlement
      ? 'promo_pro'
      : hasPaidEntitlement
        ? 'pro'
        : 'free';

  return {
    userId: typeof row.userId === 'string' ? row.userId : fallbackUserId,
    plan: effectivePlan,
    hasPro: effectiveHasPro,
    entitlementSource: normalizedSource,
    entitlementEndsAt: typeof row.entitlementEndsAt === 'string' ? row.entitlementEndsAt : null,
    billingEnabled: row.billingEnabled === true,
    promoEnabled: row.promoEnabled === true,
    promoActive,
    canAccessBilling: row.canAccessBilling === true,
    promoBannerEnabled: row.promoBannerEnabled === true,
    promoContentConfig: asRecord(row.promoContentConfig),
    promoEndsAtUtc: typeof row.promoEndsAtUtc === 'string' ? row.promoEndsAtUtc : null,
    promoEndsAtLagos: typeof row.promoEndsAtLagos === 'string' ? row.promoEndsAtLagos : null,
    retentionDays: Number.isFinite(Number(row.retentionDays)) ? Math.max(1, Math.floor(Number(row.retentionDays))) : FREE_PLAN_EXPIRATION_DAYS,
    asOf: typeof row.asOf === 'string' ? row.asOf : null,
    source: typeof row.source === 'string' && row.source.trim() ? row.source : 'api',
  };
}

export function useEffectiveEntitlements() {
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { isOnline } = useNetworkStatus();
  const { isAuthLocked } = useSmartAuth();

  const [entitlements, setEntitlements] = useState<EffectiveEntitlements>(FAIL_CLOSED_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);
  const [isUsingCachedData, setIsUsingCachedData] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const isFetchingRef = useRef(false);

  const readCached = useCallback(async () => {
    if (!user?.id) return { data: null as EffectiveEntitlements | null, cachedAt: null as number | null };
    return readUserCache<EffectiveEntitlements>({
      userId: user.id,
      route: ENTITLEMENTS_CACHE_ROUTE,
      source: ENTITLEMENTS_CACHE_SOURCE,
      endpoint: 'get',
      schemaVersion: ENTITLEMENTS_CACHE_SCHEMA,
      maxAgeMs: ENTITLEMENTS_CACHE_TTL_MS,
    });
  }, [user?.id]);

  const writeCached = useCallback(async (next: EffectiveEntitlements) => {
    if (!user?.id) return;
    await writeUserCache({
      userId: user.id,
      route: ENTITLEMENTS_CACHE_ROUTE,
      source: ENTITLEMENTS_CACHE_SOURCE,
      endpoint: 'get',
      schemaVersion: ENTITLEMENTS_CACHE_SCHEMA,
      ttlMs: ENTITLEMENTS_CACHE_TTL_MS,
      data: next,
    });
  }, [user?.id]);

  const fetchEntitlements = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id) {
      setEntitlements(FAIL_CLOSED_ENTITLEMENTS);
      setIsUsingCachedData(false);
      setCachedAt(null);
      setLoading(false);
      return;
    }

    if (isAuthLocked) {
      setEntitlements((prev) => ({
        ...FAIL_CLOSED_ENTITLEMENTS,
        userId: user.id,
        source: 'auth_locked_fail_closed',
      }));
      setLoading(false);
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!opts?.silent) {
      setLoading(true);
    }

    try {
      if (!isOnline) {
        const cached = await readCached();
        if (cached.data) {
          setEntitlements(normalizeEntitlements(cached.data, user.id));
          setIsUsingCachedData(true);
          setCachedAt(cached.cachedAt);
        } else {
          setEntitlements({
            ...FAIL_CLOSED_ENTITLEMENTS,
            userId: user.id,
            source: 'offline_fail_closed',
          });
          setIsUsingCachedData(false);
          setCachedAt(null);
        }
        return;
      }

      const headers = new Headers();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }

      const response = await safeFetch('/api/entitlements/effective', {
        method: 'GET',
        headers,
        credentials: 'include',
        timeout: 10_000,
        silent: true,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(
            payload?.message || payload?.error || payload?.code || `Failed to load entitlements (${response.status})`,
          ),
        );
      }

      const normalized = normalizeEntitlements(payload, user.id);
      setEntitlements(normalized);
      setIsUsingCachedData(false);
      setCachedAt(Date.now());
      void writeCached(normalized);
    } catch (error) {
      console.warn('[entitlements] Failed to fetch effective entitlements', error);
      const cached = await readCached();
      if (cached.data) {
        setEntitlements(normalizeEntitlements(cached.data, user.id));
        setIsUsingCachedData(true);
        setCachedAt(cached.cachedAt);
      } else {
        setEntitlements({
          ...FAIL_CLOSED_ENTITLEMENTS,
          userId: user.id,
          source: 'fetch_error_fail_closed',
        });
        setIsUsingCachedData(false);
        setCachedAt(null);
      }
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [isAuthLocked, isOnline, readCached, session?.access_token, user?.id, writeCached]);

  useEffect(() => {
    if (isLoadingAuth) return;
    void fetchEntitlements();
  }, [fetchEntitlements, isLoadingAuth]);

  useEffect(() => {
    if (!user?.id || !isOnline || isAuthLocked) return;

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimeout) return;
      refreshTimeout = setTimeout(() => {
        refreshTimeout = null;
        void fetchEntitlements({ silent: true });
      }, 150);
    };

    const channel = supabase
      .channel(`effective-entitlements:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_flags' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_user_profiles', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entitlement_grants', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_plan_transitions', filter: `user_id=eq.${user.id}` },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[entitlements] realtime channel degraded; relying on polling fallback.');
        }
      });

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      void supabase.removeChannel(channel);
    };
  }, [fetchEntitlements, isAuthLocked, isOnline, user?.id]);

  useEffect(() => {
    if (!user?.id || !isOnline || isAuthLocked) return;
    const timer = window.setInterval(() => {
      void fetchEntitlements({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchEntitlements, isAuthLocked, isOnline, user?.id]);

  const value = useMemo(
    () => ({
      entitlements,
      loading,
      isUsingCachedData,
      cachedAt,
      refresh: async () => {
        await fetchEntitlements();
      },
    }),
    [cachedAt, entitlements, fetchEntitlements, isUsingCachedData, loading],
  );

  return value;
}
