"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEffectiveEntitlementsSnapshot = getEffectiveEntitlementsSnapshot;
const plans_1 = require("@/lib/billing/plans");
const subscription_policy_1 = require("@/lib/plans/subscription-policy");
const feature_flags_1 = require("@/lib/server/feature-flags");
const promo_entitlements_1 = require("@/lib/server/promo-entitlements");
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function isMissingFunctionError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return (code === '42883' ||
        (message.includes('function') && message.includes('does not exist')) ||
        (message.includes('schema cache') && message.includes('function')));
}
function isSchemaDriftError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return (code === '42P01' ||
        code === '42703' ||
        (message.includes('relation') && message.includes('does not exist')) ||
        (message.includes('column') && message.includes('does not exist')));
}
function hasPaidAccess(plan, entitlementSource, promoActive) {
    return (plan === 'admin' ||
        plan === 'premium' ||
        plan === 'promo_pro' ||
        promoActive ||
        (plan === 'pro' && entitlementSource !== 'none'));
}
function normalizeRpcSnapshot(payload, userId) {
    const row = asRecord(payload);
    const plan = (0, plans_1.normalizeEffectiveEntitlementPlan)(row.plan);
    const entitlementSource = (0, plans_1.normalizeBillingEntitlementSource)(row.entitlement_source ?? row.entitlementSource);
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
            : (0, subscription_policy_1.resolvePlanExpirationDays)({ plan, entitlementSource }),
        asOf: typeof row.as_of === 'string'
            ? row.as_of
            : typeof row.asOf === 'string'
                ? row.asOf
                : new Date().toISOString(),
        source: 'rpc',
    };
}
async function buildFallbackSnapshot(supabase, userId) {
    const flags = await (0, feature_flags_1.getFeatureFlagsSnapshot)(supabase).catch(() => new Map());
    const billingEnabled = Boolean(flags.get('billing_enabled')?.enabled);
    const promoEnabled = Boolean(flags.get('promo_enabled')?.enabled);
    const promoActive = promoEnabled && (0, promo_entitlements_1.isPromoProActive)();
    const promoContentConfig = asRecord(flags.get('promo_content')?.config);
    let plan = 'free';
    let entitlementSource = 'none';
    let entitlementEndsAt = null;
    const entitlementRes = await supabase
        .from('au_user_entitlements')
        .select('plan,source,expires_at')
        .eq('user_id', userId)
        .maybeSingle();
    if (entitlementRes.error && !isSchemaDriftError(entitlementRes.error)) {
        throw entitlementRes.error;
    }
    if (!entitlementRes.error && entitlementRes.data) {
        plan = (0, plans_1.normalizeEffectiveEntitlementPlan)(entitlementRes.data.plan);
        entitlementSource = (0, plans_1.normalizeBillingEntitlementSource)(entitlementRes.data.source);
        entitlementEndsAt = typeof entitlementRes.data.expires_at === 'string'
            ? entitlementRes.data.expires_at
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
            entitlementEndsAt = typeof grantRes.data.ends_at === 'string'
                ? grantRes.data.ends_at
                : null;
        }
        else if (promoActive) {
            plan = 'promo_pro';
            entitlementSource = 'promo';
            entitlementEndsAt = promo_entitlements_1.PROMO_PRO_END_UTC_ISO;
        }
        else {
            const profileRes = await supabase
                .from('au_user_profiles')
                .select('tier,tier_expires_at')
                .eq('user_id', userId)
                .maybeSingle();
            if (profileRes.error && !isSchemaDriftError(profileRes.error)) {
                throw profileRes.error;
            }
            if (!profileRes.error && profileRes.data) {
                plan = (0, plans_1.normalizeEffectiveEntitlementPlan)(profileRes.data.tier);
                entitlementSource = plan === 'free' ? 'none' : 'paid';
                entitlementEndsAt = typeof profileRes.data.tier_expires_at === 'string'
                    ? profileRes.data.tier_expires_at
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
        promoEndsAtUtc: promo_entitlements_1.PROMO_PRO_END_UTC_ISO,
        promoEndsAtLagos: promo_entitlements_1.PROMO_PRO_END_LAGOS_ISO,
        retentionDays: (0, subscription_policy_1.resolvePlanExpirationDays)({
            plan: plan === 'admin' ? 'pro' : plan,
            entitlementSource,
        }),
        asOf: new Date().toISOString(),
        source: 'server_fallback',
    };
}
async function getEffectiveEntitlementsSnapshot(supabase, userId) {
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
