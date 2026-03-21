'use client';

import { useMemo } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useAccountSnapshot } from '@/components/providers/account-snapshot-provider';
import { FREE_PLAN_EXPIRATION_DAYS } from '@/lib/plans/subscription-policy';

export type EffectiveEntitlements = {
  userId: string | null;
  plan: 'unknown' | 'free' | 'pro' | 'promo_pro' | 'premium' | 'admin';
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

const SIGNED_OUT_ENTITLEMENTS: EffectiveEntitlements = {
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
  source: 'signed_out',
};

function buildUnknownEntitlements(userId: string | null): EffectiveEntitlements {
  return {
    ...SIGNED_OUT_ENTITLEMENTS,
    userId,
    plan: 'unknown',
    source: 'account_snapshot_pending',
  };
}

export function useEffectiveEntitlements() {
  const [user] = useSupabaseUser();
  const { snapshot, loading, isUsingCachedData, cachedAt, refresh } = useAccountSnapshot();

  const entitlements = useMemo<EffectiveEntitlements>(() => {
    if (snapshot?.entitlements) {
      return {
        ...snapshot.entitlements,
        plan: snapshot.entitlements.plan,
      };
    }
    if (!user?.id) {
      return SIGNED_OUT_ENTITLEMENTS;
    }
    return buildUnknownEntitlements(user.id);
  }, [snapshot?.entitlements, user?.id]);

  return useMemo(
    () => ({
      entitlements,
      loading,
      isUsingCachedData,
      cachedAt,
      refresh: async () => {
        await refresh();
      },
    }),
    [cachedAt, entitlements, isUsingCachedData, loading, refresh],
  );
}
