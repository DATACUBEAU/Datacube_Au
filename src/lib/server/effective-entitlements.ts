import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeBillingEntitlementSource,
  normalizeEffectiveEntitlementPlan,
  type CanonicalEntitlementSource,
  type EffectiveEntitlementPlan,
} from '@/lib/billing/plans';
import { resolvePlanExpirationDays } from '@/lib/plans/subscription-policy';
import { getFeatureFlagsSnapshot } from '@/lib/server/feature-flags';
import {
  PROMO_PRO_END_LAGOS_ISO,
  PROMO_PRO_END_UTC_ISO,
  isPromoProActive,
} from '@/lib/server/promo-entitlements';

export type EffectiveEntitlementsSnapshot = {
  userId: string;
  plan: EffectiveEntitlementPlan;
  hasPro: boolean;
  entitlementSource: CanonicalEntitlementSource;
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
  asOf: string;
  source: 'rpc' | 'server_fallback';
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isMissingFunctionError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42883' ||
    (message.includes('function') && message.includes('does not exist')) ||
    (message.includes('schema cache') && message.includes('function'))
  );
}

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    (message.includes('column') && message.includes('does not exist'))
  );
}

function hasPaidAccess(plan: EffectiveEntitlementPlan, entitlementSource: CanonicalEntitlementSource, promoActive: boolean): boolean {
  return (
    plan === 'admin' ||
    plan === 'premium' ||
    plan === 'promo_pro' ||
    promoActive ||
    (plan === 'pro' && entitlementSource !== 'none')
  );
}

function normalizeRpcSnapshot(payload: unknown, userId: string): EffectiveEntitlementsSnapshot {
  const row = asRecord(payload);
  const plan = normalizeEffectiveEntitlementPlan(row.plan);
  const entitlementSource = normalizeBillingEntitlementSource(row.entitlement_source ?? row.entitlementSource);
  const promoActive = Boolean(row.promo_active ?? row.promoActive);

  return {
    userId: typeof row.user_id === 'string' ? row.user_id : userId,
    plan,
    hasPro: Boolean(row.has_pro ?? row.hasPro) || hasPaidAccess(plan, entitlementSource, promoActive),
    entitlementSource,
    entitlementEndsAt: typeof row.entitlement_ends_at === 'string'
      ? row.entitlement_ends_at
      : typeof row.entitlementEndsAt === 'string'
        ? row.entitlementEndsAt
        : null,
    billingEnabled: Boolean(row.billing_enabled ?? row.billingEnabled),
    promoEnabled: Boolean(row.promo_enabled ?? row.promoEnabled),
    promoActive,
    canAccessBilling: Boolean(row.can_access_billing ?? row.canAccessBilling),
    promoBannerEnabled: Boolean(row.promo_banner_enabled ?? row.promoBannerEnabled),
    promoContentConfig: asRecord(row.promo_content_config ?? row.promoContentConfig),
    promoEndsAtUtc: typeof row.promo_ends_at_utc === 'string'
      ? row.promo_ends_at_utc
      : typeof row.promoEndsAtUtc === 'string'
        ? row.promoEndsAtUtc
        : null,
    promoEndsAtLagos: typeof row.promo_ends_at_lagos === 'string'
      ? row.promo_ends_at_lagos
      : typeof row.promoEndsAtLagos === 'string'
        ? row.promoEndsAtLagos
        : null,
    retentionDays: Number.isFinite(Number(row.retention_days ?? row.retentionDays))
      ? Math.max(1, Math.floor(Number(row.retention_days ?? row.retentionDays)))
      : resolvePlanExpirationDays({ plan, entitlementSource }),
    asOf: typeof row.as_of === 'string'
      ? row.as_of
      : typeof row.asOf === 'string'
        ? row.asOf
        : new Date().toISOString(),
    source: 'rpc',
  };
}

async function buildFallbackSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectiveEntitlementsSnapshot> {
  const flags = await getFeatureFlagsSnapshot(supabase).catch(() => new Map());
  const billingEnabled = Boolean(flags.get('billing_enabled')?.enabled);
  const promoEnabled = Boolean(flags.get('promo_enabled')?.enabled);
  const promoActive = promoEnabled && isPromoProActive();
  const promoContentConfig = asRecord(flags.get('promo_content')?.config);

  let plan: EffectiveEntitlementPlan = 'free';
  let entitlementSource: CanonicalEntitlementSource = 'none';
  let entitlementEndsAt: string | null = null;

  const entitlementRes = await supabase
    .from('au_user_entitlements')
    .select('plan,source,expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (entitlementRes.error && !isSchemaDriftError(entitlementRes.error)) {
    throw entitlementRes.error;
  }
  if (!entitlementRes.error && entitlementRes.data) {
    plan = normalizeEffectiveEntitlementPlan((entitlementRes.data as any).plan);
    entitlementSource = normalizeBillingEntitlementSource((entitlementRes.data as any).source);
    entitlementEndsAt = typeof (entitlementRes.data as any).expires_at === 'string'
      ? (entitlementRes.data as any).expires_at
      : null;
  }

  if (plan === 'free' && entitlementSource === 'none') {
    const nowIso = new Date().toISOString();
    const grantRes = await supabase
      .from('entitlement_grants')
      .select('ends_at')
      .eq('user_id', userId)
      .eq('entitlement', 'pro')
      .eq('status', 'active')
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('ends_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (grantRes.error && !isSchemaDriftError(grantRes.error)) {
      throw grantRes.error;
    }

    if (!grantRes.error && grantRes.data) {
      plan = 'pro';
      entitlementSource = 'paid';
      entitlementEndsAt = typeof (grantRes.data as any).ends_at === 'string'
        ? (grantRes.data as any).ends_at
        : null;
    } else if (promoActive) {
      plan = 'promo_pro';
      entitlementSource = 'promo';
      entitlementEndsAt = PROMO_PRO_END_UTC_ISO;
    } else {
      const profileRes = await supabase
        .from('au_user_profiles')
        .select('tier,tier_expires_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileRes.error && !isSchemaDriftError(profileRes.error)) {
        throw profileRes.error;
      }
      if (!profileRes.error && profileRes.data) {
        plan = normalizeEffectiveEntitlementPlan((profileRes.data as any).tier);
        entitlementSource = plan === 'free' ? 'none' : 'paid';
        entitlementEndsAt = typeof (profileRes.data as any).tier_expires_at === 'string'
          ? (profileRes.data as any).tier_expires_at
          : null;
      }
    }
  }

  return {
    userId,
    plan,
    hasPro: hasPaidAccess(plan, entitlementSource, promoActive),
    entitlementSource,
    entitlementEndsAt,
    billingEnabled,
    promoEnabled,
    promoActive,
    canAccessBilling: billingEnabled && !promoActive,
    promoBannerEnabled: promoActive,
    promoContentConfig,
    promoEndsAtUtc: PROMO_PRO_END_UTC_ISO,
    promoEndsAtLagos: PROMO_PRO_END_LAGOS_ISO,
    retentionDays: resolvePlanExpirationDays({
      plan: plan === 'admin' ? 'pro' : plan,
      entitlementSource,
    }),
    asOf: new Date().toISOString(),
    source: 'server_fallback',
  };
}

export async function getEffectiveEntitlementsSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectiveEntitlementsSnapshot> {
  const { data, error } = await supabase.rpc('get_effective_entitlements', {
    p_user_id: userId,
  });

  if (error) {
    if (!isMissingFunctionError(error)) {
      throw error;
    }
    return buildFallbackSnapshot(supabase, userId);
  }

  return normalizeRpcSnapshot(data, userId);
}
