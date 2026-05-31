import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deriveNormalizedSubscriptionState,
  type NormalizedSubscriptionState,
} from '@/lib/billing/subscription-state';
import {
  resolveCanonicalEffectiveLimits,
  type EffectiveLimitsResult,
  type EffectivePlan,
} from '@/lib/server/au-limits';
import {
  getEffectiveEntitlementsSnapshot,
  type EffectiveEntitlementsSnapshot,
} from '@/lib/server/effective-entitlements';
import { normalizeAdminOverridePlan } from '@/lib/admin/protected-owner';

export type CanonicalAccountPlanAuthority = {
  validatedAt: string;
  limits: EffectiveLimitsResult;
  effectivePlan: EffectivePlan;
  entitlements: EffectiveEntitlementsSnapshot;
};

export async function resolveCanonicalAccountPlanAuthority(input: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<CanonicalAccountPlanAuthority> {
  const [limits, entitlements] = await Promise.all([
    resolveCanonicalEffectiveLimits({
      supabase: input.supabase,
      userId: input.userId,
    }),
    getEffectiveEntitlementsSnapshot(input.supabase, input.userId),
  ]);

  return {
    validatedAt: new Date().toISOString(),
    limits,
    effectivePlan: limits.effectivePlan,
    entitlements,
  };
}

export function buildCanonicalSubscriptionState(input: {
  authority: CanonicalAccountPlanAuthority;
  profileTier?: unknown;
  subscriptionPlanKey?: unknown;
  subscriptionStatus?: unknown;
  latestPaymentPlanKey?: unknown;
}): NormalizedSubscriptionState {
  const adminOverridePlan = normalizeAdminOverridePlan(input.authority.entitlements.adminOverridePlan);
  const overrideSubscriptionStatus = adminOverridePlan && adminOverridePlan !== 'free' ? 'active' : null;
  const overrideLegacyTier = adminOverridePlan
    ? adminOverridePlan === 'free'
      ? 'free'
      : 'pro'
    : null;
  return deriveNormalizedSubscriptionState({
    effectivePlan: input.authority.entitlements.plan,
    entitlementSource: input.authority.entitlements.entitlementSource,
    promoActive: input.authority.entitlements.promoActive,
    subscriptionPlanKey: adminOverridePlan || input.subscriptionPlanKey,
    subscriptionStatus: overrideSubscriptionStatus || input.subscriptionStatus,
    latestPaymentPlanKey: adminOverridePlan ? null : input.latestPaymentPlanKey,
    legacyTier: overrideLegacyTier ?? input.profileTier ?? input.authority.effectivePlan.plan,
  });
}

export function serializeCanonicalPlanSummary(input: {
  authority: CanonicalAccountPlanAuthority;
  currentPlan?: NormalizedSubscriptionState | null;
}): {
  displayPlan: string;
  effectivePlan: string;
  managedPlan: string;
  hasPro: boolean;
  isAdmin: boolean;
  entitlementSource: string;
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
  activePlanKey: string | null;
  subscriptionStatus: string | null;
  validatedAt: string;
  source: string;
} {
  const { authority } = input;
  return {
    displayPlan: authority.entitlements.plan,
    effectivePlan: authority.effectivePlan.plan,
    managedPlan:
      input.currentPlan?.managedPlan ||
      (authority.entitlements.plan === 'admin' || authority.entitlements.plan === 'premium'
        ? 'premium'
        : authority.entitlements.plan === 'promo_pro'
          ? 'pro'
          : authority.effectivePlan.plan),
    hasPro: authority.entitlements.hasPro,
    isAdmin: authority.effectivePlan.isAdmin,
    entitlementSource: authority.entitlements.entitlementSource,
    entitlementEndsAt: authority.entitlements.entitlementEndsAt,
    billingEnabled: authority.entitlements.billingEnabled,
    promoEnabled: authority.entitlements.promoEnabled,
    promoActive: authority.entitlements.promoActive,
    canAccessBilling: authority.entitlements.canAccessBilling,
    promoBannerEnabled: authority.entitlements.promoBannerEnabled,
    promoContentConfig: authority.entitlements.promoContentConfig,
    promoEndsAtUtc: authority.entitlements.promoEndsAtUtc,
    promoEndsAtLagos: authority.entitlements.promoEndsAtLagos,
    retentionDays: authority.entitlements.retentionDays,
    activePlanKey: input.currentPlan?.activePlanKey || null,
    subscriptionStatus: input.currentPlan?.subscriptionStatus || null,
    validatedAt: authority.validatedAt,
    source: authority.effectivePlan.source,
  };
}
