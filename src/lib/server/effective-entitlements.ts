import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeBillingEntitlementSource,
  normalizeCanonicalBillingPlanKey,
  normalizeEffectiveEntitlementPlan,
  type CanonicalEntitlementSource,
  type EffectiveEntitlementPlan,
} from '@/lib/billing/plans';
import {
  isPaidAdminOverridePlan,
  normalizeAdminOverridePlan,
  type AdminOverridePlan,
} from '@/lib/admin/protected-owner';
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
  adminOverridePlan: AdminOverridePlan | null;
  asOf: string;
  source: 'rpc' | 'server_fallback' | 'admin_override';
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

function overrideToEffectivePlan(overridePlan: AdminOverridePlan): EffectiveEntitlementPlan {
  if (overridePlan === 'premium') return 'premium';
  return isPaidAdminOverridePlan(overridePlan) ? 'pro' : 'free';
}

function overrideToEntitlementSource(overridePlan: AdminOverridePlan): CanonicalEntitlementSource {
  return isPaidAdminOverridePlan(overridePlan) ? 'paid' : 'none';
}

function buildOverrideSnapshot(input: {
  userId: string;
  overridePlan: AdminOverridePlan;
  billingEnabled: boolean;
  promoEnabled: boolean;
  promoActive: boolean;
  promoContentConfig: Record<string, unknown>;
}): EffectiveEntitlementsSnapshot {
  const plan = overrideToEffectivePlan(input.overridePlan);
  const entitlementSource = overrideToEntitlementSource(input.overridePlan);
  return {
    userId: input.userId,
    plan,
    hasPro: plan === 'pro',
    entitlementSource,
    entitlementEndsAt: null,
    billingEnabled: input.billingEnabled,
    promoEnabled: input.promoEnabled,
    promoActive: input.promoActive,
    canAccessBilling: input.billingEnabled && !input.promoActive,
    promoBannerEnabled: input.promoActive,
    promoContentConfig: input.promoContentConfig,
    promoEndsAtUtc: PROMO_PRO_END_UTC_ISO,
    promoEndsAtLagos: PROMO_PRO_END_LAGOS_ISO,
    retentionDays: resolvePlanExpirationDays({ plan, entitlementSource }),
    adminOverridePlan: input.overridePlan,
    asOf: new Date().toISOString(),
    source: 'admin_override',
  };
}

function normalizeRpcSnapshot(payload: unknown, userId: string): EffectiveEntitlementsSnapshot {
  const row = asRecord(payload);
  const adminOverridePlan = normalizeAdminOverridePlan(row.admin_override_plan ?? row.adminOverridePlan);
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
    adminOverridePlan,
    asOf: typeof row.as_of === 'string'
      ? row.as_of
      : typeof row.asOf === 'string'
        ? row.asOf
        : new Date().toISOString(),
    source: adminOverridePlan ? 'admin_override' : 'rpc',
  };
}

async function readEntitlementRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  plan?: string | null;
  source?: string | null;
  expires_at?: string | null;
  admin_override_plan?: string | null;
} | null> {
  const withOverride = await supabase
    .from('au_user_entitlements')
    .select('plan,source,expires_at,admin_override_plan')
    .eq('user_id', userId)
    .maybeSingle();
  if (!withOverride.error) return (withOverride.data || null) as any;
  if (!isSchemaDriftError(withOverride.error)) throw withOverride.error;

  const legacy = await supabase
    .from('au_user_entitlements')
    .select('plan,source,expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (legacy.error && !isSchemaDriftError(legacy.error)) throw legacy.error;
  return legacy.error ? null : ((legacy.data || null) as any);
}

async function readActiveSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ planKey: string; endsAt: string | null } | null> {
  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select('plan_key,status,ends_at,updated_at')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'non_renewing'])
    .order('updated_at', { ascending: false })
    .limit(5);
  if (error) {
    if (isSchemaDriftError(error)) return null;
    throw error;
  }

  const nowMs = Date.now();
  for (const row of data || []) {
    const planKey = normalizeCanonicalBillingPlanKey((row as any)?.plan_key);
    if (!planKey || planKey === 'free') continue;
    const endsAt = typeof (row as any)?.ends_at === 'string' ? String((row as any).ends_at) : null;
    const endsAtMs = endsAt ? new Date(endsAt).getTime() : Number.NaN;
    if (endsAt && Number.isFinite(endsAtMs) && endsAtMs <= nowMs) continue;
    return { planKey, endsAt };
  }

  return null;
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

  const entitlementRow = await readEntitlementRow(supabase, userId);
  const adminOverridePlan = normalizeAdminOverridePlan(entitlementRow?.admin_override_plan);
  if (adminOverridePlan) {
    return buildOverrideSnapshot({
      userId,
      overridePlan: adminOverridePlan,
      billingEnabled,
      promoEnabled,
      promoActive,
      promoContentConfig,
    });
  }

  const activeSubscription = await readActiveSubscription(supabase, userId);
  if (activeSubscription) {
    plan = normalizeEffectiveEntitlementPlan(activeSubscription.planKey);
    entitlementSource = 'paid';
    entitlementEndsAt = activeSubscription.endsAt;
  } else if (entitlementRow) {
    const candidatePlan = normalizeEffectiveEntitlementPlan(entitlementRow.plan);
    const candidateSource = normalizeBillingEntitlementSource(entitlementRow.source);
    const candidateEndsAt = typeof entitlementRow.expires_at === 'string' ? entitlementRow.expires_at : null;
    const expiresAtMs = candidateEndsAt ? new Date(candidateEndsAt).getTime() : Number.NaN;
    const isExpired = candidateEndsAt && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
    if (!isExpired) {
      plan = candidatePlan;
      entitlementSource = candidateSource;
      entitlementEndsAt = candidateEndsAt;
    }
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
    adminOverridePlan: null,
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
