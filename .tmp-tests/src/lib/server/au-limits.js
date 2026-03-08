"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EffectiveLimitError = exports.DEFAULT_PLAN_METADATA = exports.DEFAULT_PLAN_LIMITS = exports.LIMIT_COLUMN_KEYS = exports.PLAN_RESET_COLUMN_KEYS = exports.DEFAULT_PLAN_ORDER = void 0;
exports.describeResetEveryDays = describeResetEveryDays;
exports.computeQuotaWindowBounds = computeQuotaWindowBounds;
exports.resolveEffectivePlan = resolveEffectivePlan;
exports.loadPlanLimits = loadPlanLimits;
exports.loadPlanMetadata = loadPlanMetadata;
exports.loadPublicPlanCatalog = loadPublicPlanCatalog;
exports.safeSelectDocuments = safeSelectDocuments;
exports.getEffectiveLimits = getEffectiveLimits;
exports.throwUploadLimitIfNeeded = throwUploadLimitIfNeeded;
exports.throwIngestLimitIfNeeded = throwIngestLimitIfNeeded;
exports.throwChatLimitIfNeeded = throwChatLimitIfNeeded;
exports.throwExamLimitIfNeeded = throwExamLimitIfNeeded;
const feature_flags_1 = require("@/lib/server/feature-flags");
const entitlements_1 = require("@/lib/server/entitlements");
const subscription_policy_1 = require("@/lib/plans/subscription-policy");
const large_file_gating_1 = require("@/lib/upload/large-file-gating");
const ONE_MB_BYTES = 1024 * 1024;
const EPOCH_START_ISO = '1970-01-01T00:00:00.000Z';
const FAR_FUTURE_END_ISO = '9999-12-31T23:59:59.999Z';
exports.DEFAULT_PLAN_ORDER = ['free', 'pro', 'premium'];
const HARD_LIMIT_COLUMN_KEYS = [
    'max_file_size_mb',
    'max_uploads_total',
    'max_documents_total',
    'max_chats_total',
    'max_exams_total',
    'max_tokens_total',
    'max_storage_mb',
    'max_concurrent_jobs',
];
exports.PLAN_RESET_COLUMN_KEYS = [
    'tokens_reset_every_days',
    'chats_reset_every_days',
    'uploads_reset_every_days',
    'documents_reset_every_days',
    'exams_reset_every_days',
    'storage_reset_every_days',
];
exports.LIMIT_COLUMN_KEYS = [
    ...HARD_LIMIT_COLUMN_KEYS,
    ...exports.PLAN_RESET_COLUMN_KEYS,
];
const LIMIT_ALIASES = {
    max_file_size_mb: ['max_file_mb'],
    max_uploads_total: ['max_uploads_total'],
    max_documents_total: ['max_docs_total'],
    max_chats_total: ['max_chats_total'],
    max_exams_total: ['max_exams_total'],
    max_tokens_total: ['max_tokens_total'],
    max_storage_mb: ['max_storage_mb'],
    max_concurrent_jobs: ['max_jobs_concurrent'],
};
exports.DEFAULT_PLAN_LIMITS = {
    free: {
        max_file_size_mb: 50,
        max_uploads_total: 50,
        max_documents_total: 50,
        max_chats_total: 3000,
        max_exams_total: 10,
        max_tokens_total: subscription_policy_1.TOKEN_LIMITS_BY_PLAN.free,
        max_storage_mb: 2000,
        max_concurrent_jobs: 1,
        tokens_reset_every_days: 1,
        chats_reset_every_days: 1,
        uploads_reset_every_days: 0,
        documents_reset_every_days: 0,
        exams_reset_every_days: 0,
        storage_reset_every_days: 0,
    },
    pro: {
        max_file_size_mb: 50,
        max_uploads_total: 500,
        max_documents_total: 500,
        max_chats_total: 30000,
        max_exams_total: 200,
        max_tokens_total: subscription_policy_1.TOKEN_LIMITS_BY_PLAN.pro,
        max_storage_mb: 20000,
        max_concurrent_jobs: 3,
        tokens_reset_every_days: 1,
        chats_reset_every_days: 1,
        uploads_reset_every_days: 0,
        documents_reset_every_days: 0,
        exams_reset_every_days: 0,
        storage_reset_every_days: 0,
    },
    premium: {
        max_file_size_mb: 50,
        max_uploads_total: 1500,
        max_documents_total: 1500,
        max_chats_total: 100000,
        max_exams_total: 1000,
        max_tokens_total: subscription_policy_1.TOKEN_LIMITS_BY_PLAN.premium,
        max_storage_mb: 100000,
        max_concurrent_jobs: 6,
        tokens_reset_every_days: 1,
        chats_reset_every_days: 1,
        uploads_reset_every_days: 0,
        documents_reset_every_days: 0,
        exams_reset_every_days: 0,
        storage_reset_every_days: 0,
    },
};
exports.DEFAULT_PLAN_METADATA = {
    free: {
        label: 'Free',
        description: 'Core study tools with sensible daily AI quotas and lifetime document caps.',
        price_display: 'NGN 0',
        monthly_amount_ngn: 0,
        monthly_compare_at_ngn: null,
        monthly_badge: '',
        weekly_amount_ngn: 0,
        weekly_compare_at_ngn: null,
        weekly_badge: '',
        feature_bullets: ['Core chat', 'Upload up to 50 documents', 'Practice from saved outputs', 'Basic support'],
        cta_label: 'Current plan',
        cta_href: '/dashboard',
        sort_order: 0,
        retention_days: subscription_policy_1.FREE_PLAN_EXPIRATION_DAYS,
        expiration_days: subscription_policy_1.FREE_PLAN_EXPIRATION_DAYS,
    },
    pro: {
        label: 'Pro',
        description: 'Higher daily AI budgets, more storage, and access to advanced study workflows.',
        price_display: 'NGN 4,500/month or NGN 1,500/week',
        monthly_amount_ngn: 4500,
        monthly_compare_at_ngn: 6000,
        monthly_badge: 'Save 25%',
        weekly_amount_ngn: 1500,
        weekly_compare_at_ngn: 2500,
        weekly_badge: 'Save 40%',
        feature_bullets: ['Knowledge Hub', 'Exam Prediction Engine', 'Priority processing', 'Expanded quotas'],
        cta_label: 'Upgrade now',
        cta_href: '/dashboard/settings/subscription',
        sort_order: 1,
        retention_days: subscription_policy_1.PAID_PRO_PLAN_EXPIRATION_DAYS,
        expiration_days: subscription_policy_1.PAID_PRO_PLAN_EXPIRATION_DAYS,
    },
    premium: {
        label: 'Premium',
        description: 'Custom higher-volume workspace for extended storage, concurrency, and tailored support.',
        price_display: 'Custom pricing',
        monthly_amount_ngn: null,
        monthly_compare_at_ngn: null,
        monthly_badge: '',
        weekly_amount_ngn: null,
        weekly_compare_at_ngn: null,
        weekly_badge: '',
        feature_bullets: ['Everything in Pro', 'Higher concurrency', 'Custom support', 'Expanded storage'],
        cta_label: 'Contact admin',
        cta_href: '/dashboard/settings/subscription',
        sort_order: 2,
        retention_days: subscription_policy_1.PREMIUM_PLAN_EXPIRATION_DAYS,
        expiration_days: subscription_policy_1.PREMIUM_PLAN_EXPIRATION_DAYS,
    },
};
class EffectiveLimitError extends Error {
    constructor(status, payload, headers) {
        super(payload.message);
        this.status = status;
        this.payload = payload;
        this.headers = headers || {};
    }
}
exports.EffectiveLimitError = EffectiveLimitError;
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function asStringList(value, fallback) {
    if (!Array.isArray(value))
        return [...fallback];
    const cleaned = value
        .map((entry) => String(entry ?? '').trim())
        .filter(Boolean);
    return cleaned.length > 0 ? cleaned : [...fallback];
}
function isSchemaDriftError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return (code === '42P01' ||
        code === '42703' ||
        message.includes('does not exist') ||
        details.includes('does not exist'));
}
function clampNonNegativeNumber(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0)
        return fallback;
    return Math.floor(numeric);
}
function clampNullableNonNegativeNumber(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0)
        return null;
    return Math.floor(numeric);
}
function asTrimmedString(value, fallback) {
    const next = String(value ?? '').trim();
    return next || fallback;
}
function normalizePlan(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'premium')
        return 'premium';
    if (raw === 'pro' || raw === 'promo_pro' || raw === 'weekly' || raw === 'monthly' || raw === 'paid') {
        return 'pro';
    }
    return 'free';
}
function normalizeProfileTier(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw)
        return { isAdmin: false, plan: null };
    if (raw === 'admin')
        return { isAdmin: true, plan: 'pro' };
    if (raw === 'premium')
        return { isAdmin: false, plan: 'premium' };
    if (['pro', 'weekly', 'monthly', 'paid'].includes(raw))
        return { isAdmin: false, plan: 'pro' };
    if (raw === 'free')
        return { isAdmin: false, plan: 'free' };
    return { isAdmin: false, plan: null };
}
function withAliases(limits) {
    const out = {};
    for (const key of exports.LIMIT_COLUMN_KEYS) {
        out[key] = limits[key];
        const aliases = LIMIT_ALIASES[key];
        if (aliases) {
            for (const alias of aliases) {
                out[alias] = limits[key];
            }
        }
    }
    return out;
}
function normalizePlanMetadata(plan, input) {
    const source = asRecord(input);
    const defaults = exports.DEFAULT_PLAN_METADATA[plan];
    return {
        label: asTrimmedString(source.label, defaults.label),
        description: asTrimmedString(source.description, defaults.description),
        price_display: asTrimmedString(source.price_display ?? source.priceDisplay, defaults.price_display),
        monthly_amount_ngn: clampNullableNonNegativeNumber(source.monthly_amount_ngn ?? source.monthlyAmountNgn) ?? defaults.monthly_amount_ngn,
        monthly_compare_at_ngn: clampNullableNonNegativeNumber(source.monthly_compare_at_ngn ?? source.monthlyCompareAtNgn) ?? defaults.monthly_compare_at_ngn,
        monthly_badge: asTrimmedString(source.monthly_badge ?? source.monthlyBadge, defaults.monthly_badge),
        weekly_amount_ngn: clampNullableNonNegativeNumber(source.weekly_amount_ngn ?? source.weeklyAmountNgn) ?? defaults.weekly_amount_ngn,
        weekly_compare_at_ngn: clampNullableNonNegativeNumber(source.weekly_compare_at_ngn ?? source.weeklyCompareAtNgn) ?? defaults.weekly_compare_at_ngn,
        weekly_badge: asTrimmedString(source.weekly_badge ?? source.weeklyBadge, defaults.weekly_badge),
        feature_bullets: asStringList(source.feature_bullets ?? source.featureBullets, defaults.feature_bullets),
        cta_label: asTrimmedString(source.cta_label ?? source.ctaLabel, defaults.cta_label),
        cta_href: asTrimmedString(source.cta_href ?? source.ctaHref, defaults.cta_href),
        sort_order: clampNonNegativeNumber(source.sort_order ?? source.sortOrder, defaults.sort_order),
        retention_days: clampNonNegativeNumber(source.retention_days ?? source.retentionDays, defaults.retention_days),
        expiration_days: clampNonNegativeNumber(source.expiration_days ?? source.expirationDays, defaults.expiration_days),
    };
}
function fromLegacyPlanLimits(input, fallbackPlan) {
    const source = asRecord(input);
    const defaults = exports.DEFAULT_PLAN_LIMITS[fallbackPlan];
    return {
        max_file_size_mb: clampNonNegativeNumber(source.max_file_size_mb ?? source.max_file_mb, defaults.max_file_size_mb),
        max_uploads_total: clampNonNegativeNumber(source.max_uploads_total, defaults.max_uploads_total),
        max_documents_total: clampNonNegativeNumber(source.max_documents_total ?? source.max_docs_total, defaults.max_documents_total),
        max_chats_total: clampNonNegativeNumber(source.max_chats_total ?? source.max_messages_per_day, defaults.max_chats_total),
        max_exams_total: clampNonNegativeNumber(source.max_exams_total, defaults.max_exams_total),
        max_tokens_total: clampNonNegativeNumber(source.max_tokens_total ?? source.max_tokens_per_day, defaults.max_tokens_total),
        max_storage_mb: clampNonNegativeNumber(source.max_storage_mb, defaults.max_storage_mb),
        max_concurrent_jobs: clampNonNegativeNumber(source.max_concurrent_jobs ?? source.max_jobs_concurrent, defaults.max_concurrent_jobs),
        tokens_reset_every_days: clampNonNegativeNumber(source.tokens_reset_every_days, defaults.tokens_reset_every_days),
        chats_reset_every_days: clampNonNegativeNumber(source.chats_reset_every_days, defaults.chats_reset_every_days),
        uploads_reset_every_days: clampNonNegativeNumber(source.uploads_reset_every_days, defaults.uploads_reset_every_days),
        documents_reset_every_days: clampNonNegativeNumber(source.documents_reset_every_days, defaults.documents_reset_every_days),
        exams_reset_every_days: clampNonNegativeNumber(source.exams_reset_every_days, defaults.exams_reset_every_days),
        storage_reset_every_days: clampNonNegativeNumber(source.storage_reset_every_days, defaults.storage_reset_every_days),
    };
}
function describeResetEveryDays(resetEveryDays) {
    if (!Number.isFinite(resetEveryDays) || resetEveryDays <= 0)
        return 'No reset (lifetime)';
    if (Math.floor(resetEveryDays) === 1)
        return 'Resets daily';
    return `Resets every ${Math.floor(resetEveryDays)} days`;
}
function computeQuotaWindowBounds(resetEveryDays, now = new Date()) {
    return (0, subscription_policy_1.computeUtcQuotaWindowBounds)(resetEveryDays, now);
}
function isWithinWindow(createdAt, startIso, endIso) {
    if (!createdAt)
        return false;
    if (createdAt < startIso)
        return false;
    if (endIso && createdAt >= endIso)
        return false;
    return true;
}
function featureBulletsJson(featureBullets) {
    return featureBullets.map((value) => String(value || '').trim()).filter(Boolean);
}
async function ensurePlanSeedRow(supabase, table, plan) {
    if (table === 'au_plans') {
        const { data, error } = await supabase.from('au_plans').select('plan').eq('plan', plan).maybeSingle();
        if (error) {
            if (isSchemaDriftError(error))
                return;
            throw error;
        }
        if (!data) {
            const { error: insertError } = await supabase.from('au_plans').insert({
                plan,
                is_default: plan === 'free',
            });
            if (insertError && String(insertError?.code || '') !== '23505') {
                throw insertError;
            }
        }
        return;
    }
    if (table === 'au_plan_limits') {
        const { data, error } = await supabase.from('au_plan_limits').select('plan').eq('plan', plan).maybeSingle();
        if (error) {
            if (isSchemaDriftError(error))
                return;
            throw error;
        }
        if (!data) {
            const defaults = exports.DEFAULT_PLAN_LIMITS[plan];
            const { error: insertError } = await supabase.from('au_plan_limits').insert({
                plan,
                ...defaults,
            });
            if (insertError && String(insertError?.code || '') !== '23505') {
                throw insertError;
            }
        }
        return;
    }
    const { data, error } = await supabase.from('au_plan_metadata').select('plan').eq('plan', plan).maybeSingle();
    if (error) {
        if (isSchemaDriftError(error))
            return;
        throw error;
    }
    if (!data) {
        const defaults = exports.DEFAULT_PLAN_METADATA[plan];
        const { error: insertError } = await supabase.from('au_plan_metadata').insert({
            plan,
            ...defaults,
            feature_bullets: featureBulletsJson(defaults.feature_bullets),
        });
        if (insertError && String(insertError?.code || '') !== '23505') {
            throw insertError;
        }
    }
}
async function resolveEffectivePlan(supabase, userId) {
    const [entitlementRes, profileRes, billingEntitlement] = await Promise.all([
        supabase
            .from('au_user_entitlements')
            .select('plan,source,expires_at')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase
            .from('au_user_profiles')
            .select('tier')
            .eq('user_id', userId)
            .maybeSingle(),
        (0, entitlements_1.getProEntitlementStatus)(supabase, userId).catch(() => null),
    ]);
    const profileInfo = normalizeProfileTier(profileRes.data?.tier);
    const mirroredPlan = !entitlementRes.error && entitlementRes.data?.plan
        ? normalizePlan(entitlementRes.data.plan)
        : null;
    const mirroredSource = (0, subscription_policy_1.normalizeEntitlementSource)(entitlementRes.data?.source);
    const mirroredExpiresAt = typeof entitlementRes.data?.expires_at === 'string'
        ? String(entitlementRes.data.expires_at)
        : null;
    if (profileInfo.isAdmin) {
        return {
            plan: 'pro',
            isAdmin: true,
            hasPro: true,
            source: 'profile',
            entitlementSource: 'paid',
            expiresAt: null,
        };
    }
    if (profileInfo.plan === 'premium') {
        return {
            plan: 'premium',
            isAdmin: false,
            hasPro: true,
            source: 'profile',
            entitlementSource: 'paid',
            expiresAt: null,
        };
    }
    if (mirroredPlan === 'premium') {
        return {
            plan: 'premium',
            isAdmin: false,
            hasPro: true,
            source: 'au_user_entitlements',
            entitlementSource: mirroredSource === 'none' ? 'paid' : mirroredSource,
            expiresAt: mirroredExpiresAt,
        };
    }
    if (billingEntitlement?.hasPro) {
        return {
            plan: 'pro',
            isAdmin: false,
            hasPro: true,
            source: 'billing',
            entitlementSource: (0, subscription_policy_1.normalizeEntitlementSource)(billingEntitlement.source),
            expiresAt: billingEntitlement.endsAt,
        };
    }
    if (mirroredPlan) {
        return {
            plan: mirroredPlan,
            isAdmin: false,
            hasPro: mirroredPlan !== 'free',
            source: 'au_user_entitlements',
            entitlementSource: mirroredPlan === 'free' ? 'none' : (mirroredSource === 'none' ? 'paid' : mirroredSource),
            expiresAt: mirroredExpiresAt,
        };
    }
    if (profileInfo.plan) {
        return {
            plan: profileInfo.plan,
            isAdmin: false,
            hasPro: profileInfo.plan !== 'free',
            source: 'profile',
            entitlementSource: profileInfo.plan === 'free' ? 'none' : 'paid',
            expiresAt: null,
        };
    }
    return {
        plan: 'free',
        isAdmin: false,
        hasPro: false,
        source: 'default',
        entitlementSource: 'none',
        expiresAt: null,
    };
}
async function loadPlanLimits(supabase, plan) {
    const defaults = exports.DEFAULT_PLAN_LIMITS[plan];
    await ensurePlanSeedRow(supabase, 'au_plans', plan).catch(() => undefined);
    await ensurePlanSeedRow(supabase, 'au_plan_limits', plan).catch(() => undefined);
    const primary = await supabase
        .from('au_plan_limits')
        .select(exports.LIMIT_COLUMN_KEYS.join(','))
        .eq('plan', plan)
        .maybeSingle();
    if (!primary.error && primary.data) {
        return fromLegacyPlanLimits(primary.data, plan);
    }
    if (!isSchemaDriftError(primary.error)) {
        throw primary.error;
    }
    const fallback = await supabase
        .from('plan_limits')
        .select('limits,effective_from')
        .eq('plan', plan)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!fallback.error && fallback.data?.limits) {
        return fromLegacyPlanLimits(fallback.data.limits, plan);
    }
    return { ...defaults };
}
async function loadPlanMetadata(supabase, plan) {
    await ensurePlanSeedRow(supabase, 'au_plans', plan).catch(() => undefined);
    await ensurePlanSeedRow(supabase, 'au_plan_metadata', plan).catch(() => undefined);
    const res = await supabase
        .from('au_plan_metadata')
        .select('label,description,price_display,monthly_amount_ngn,monthly_compare_at_ngn,monthly_badge,weekly_amount_ngn,weekly_compare_at_ngn,weekly_badge,feature_bullets,cta_label,cta_href,sort_order,retention_days,expiration_days')
        .eq('plan', plan)
        .maybeSingle();
    if (!res.error && res.data) {
        return normalizePlanMetadata(plan, res.data);
    }
    if (res.error && !isSchemaDriftError(res.error)) {
        throw res.error;
    }
    return { ...exports.DEFAULT_PLAN_METADATA[plan] };
}
async function isProUploadFlagEnabled(supabase) {
    const flags = await (0, feature_flags_1.getFeatureFlagsSnapshot)(supabase).catch(() => new Map());
    return Boolean(flags.get('pro_upload_100mb')?.enabled || flags.get('upload_100mb')?.enabled);
}
function applyLimitOverrides(plan, limits, proUpload100Enabled) {
    const next = { ...limits };
    next.max_file_size_mb = plan === 'pro' && proUpload100Enabled ? 100 : 50;
    return next;
}
async function loadBillingPricingRows(supabase) {
    const res = await supabase
        .from('billing_plans')
        .select('plan_key,interval,amount_kobo,is_active')
        .in('plan_key', ['pro_weekly', 'pro_monthly'])
        .eq('is_active', true);
    if (res.error) {
        if (isSchemaDriftError(res.error))
            return {};
        throw res.error;
    }
    const out = {};
    for (const row of res.data || []) {
        const intervalRaw = String(row?.interval || '').trim().toLowerCase();
        const planKey = String(row?.plan_key || '').trim();
        const amount = Math.round(Number(row?.amount_kobo || 0) / 100);
        if ((intervalRaw !== 'monthly' && intervalRaw !== 'weekly') || !planKey || !Number.isFinite(amount))
            continue;
        const interval = intervalRaw;
        out[interval] = { amount: Math.max(0, amount), plan_key: planKey };
    }
    return out;
}
function toPricingPoint(amount, compareAt, label, planKey) {
    if (amount === null || amount === undefined || amount <= 0)
        return null;
    return {
        amount,
        compare_at: compareAt,
        label,
        plan_key: planKey,
    };
}
async function loadPublicPlanCatalog(supabase) {
    const [plansRes, pricingRows, proUpload100Enabled] = await Promise.all([
        supabase.from('au_plans').select('plan,is_default'),
        loadBillingPricingRows(supabase).catch(() => ({})),
        isProUploadFlagEnabled(supabase),
    ]);
    const planRows = !plansRes.error && plansRes.data?.length
        ? plansRes.data
        : exports.DEFAULT_PLAN_ORDER.map((plan) => ({ plan, is_default: plan === 'free' }));
    const normalizedPlanKeys = Array.from(new Set([
        ...exports.DEFAULT_PLAN_ORDER,
        ...planRows
            .map((row) => String(row?.plan || '').trim().toLowerCase())
            .filter((value) => exports.DEFAULT_PLAN_ORDER.includes(value)),
    ]));
    const entries = await Promise.all(normalizedPlanKeys.map(async (plan) => {
        const [metadata, baseLimits] = await Promise.all([
            loadPlanMetadata(supabase, plan),
            loadPlanLimits(supabase, plan),
        ]);
        const canonicalLimits = applyLimitOverrides(plan, baseLimits, proUpload100Enabled);
        const pricing = {
            monthly: plan === 'pro'
                ? toPricingPoint(pricingRows.monthly?.amount ?? metadata.monthly_amount_ngn, metadata.monthly_compare_at_ngn, metadata.monthly_badge, pricingRows.monthly?.plan_key ?? 'pro_monthly')
                : toPricingPoint(metadata.monthly_amount_ngn, metadata.monthly_compare_at_ngn, metadata.monthly_badge, null),
            weekly: plan === 'pro'
                ? toPricingPoint(pricingRows.weekly?.amount ?? metadata.weekly_amount_ngn, metadata.weekly_compare_at_ngn, metadata.weekly_badge, pricingRows.weekly?.plan_key ?? 'pro_weekly')
                : toPricingPoint(metadata.weekly_amount_ngn, metadata.weekly_compare_at_ngn, metadata.weekly_badge, null),
        };
        return {
            plan,
            isDefault: Boolean(planRows.find((row) => String(row?.plan || '').trim().toLowerCase() === plan)?.is_default ?? (plan === 'free')),
            metadata: {
                ...metadata,
                price_display: plan === 'pro' && pricing.monthly && pricing.weekly
                    ? `NGN ${pricing.monthly.amount.toLocaleString()}/month or NGN ${pricing.weekly.amount.toLocaleString()}/week`
                    : metadata.price_display,
            },
            pricing,
            limits: withAliases(canonicalLimits),
            canonicalLimits,
            resetLabels: {
                tokens: describeResetEveryDays(canonicalLimits.tokens_reset_every_days),
                chats: describeResetEveryDays(canonicalLimits.chats_reset_every_days),
                uploads: describeResetEveryDays(canonicalLimits.uploads_reset_every_days),
                documents: describeResetEveryDays(canonicalLimits.documents_reset_every_days),
                exams: describeResetEveryDays(canonicalLimits.exams_reset_every_days),
                storage: describeResetEveryDays(canonicalLimits.storage_reset_every_days),
            },
        };
    }));
    return entries.sort((a, b) => {
        if (a.metadata.sort_order !== b.metadata.sort_order) {
            return a.metadata.sort_order - b.metadata.sort_order;
        }
        return exports.DEFAULT_PLAN_ORDER.indexOf(a.plan) - exports.DEFAULT_PLAN_ORDER.indexOf(b.plan);
    });
}
function mapDocumentUsageRowsWithoutFileSize(rows) {
    return rows.map((row) => ({
        id: String(row.id),
        created_at: typeof row.created_at === 'string' ? row.created_at : null,
        file_size_bytes: null,
    }));
}
async function safeSelectDocuments(supabase, userId) {
    const columnsWithFileSize = 'id,file_size_bytes,created_at';
    const columnsWithoutFileSize = 'id,created_at';
    const ownerOrUserFilter = `owner_id.eq.${userId},user_id.eq.${userId}`;
    const ownerOrUserWithFileSize = await supabase
        .from('au_documents')
        .select(columnsWithFileSize)
        .or(ownerOrUserFilter);
    if (!ownerOrUserWithFileSize.error) {
        return (ownerOrUserWithFileSize.data || []);
    }
    if (!isSchemaDriftError(ownerOrUserWithFileSize.error)) {
        throw ownerOrUserWithFileSize.error;
    }
    const ownerOrUserWithoutFileSize = await supabase
        .from('au_documents')
        .select(columnsWithoutFileSize)
        .or(ownerOrUserFilter);
    if (!ownerOrUserWithoutFileSize.error) {
        return mapDocumentUsageRowsWithoutFileSize(ownerOrUserWithoutFileSize.data || []);
    }
    if (!isSchemaDriftError(ownerOrUserWithoutFileSize.error)) {
        throw ownerOrUserWithoutFileSize.error;
    }
    const userOnlyWithFileSize = await supabase
        .from('au_documents')
        .select(columnsWithFileSize)
        .eq('user_id', userId);
    if (!userOnlyWithFileSize.error) {
        return (userOnlyWithFileSize.data || []);
    }
    if (!isSchemaDriftError(userOnlyWithFileSize.error)) {
        throw userOnlyWithFileSize.error;
    }
    const userOnlyWithoutFileSize = await supabase
        .from('au_documents')
        .select(columnsWithoutFileSize)
        .eq('user_id', userId);
    if (!userOnlyWithoutFileSize.error) {
        return mapDocumentUsageRowsWithoutFileSize(userOnlyWithoutFileSize.data || []);
    }
    if (isSchemaDriftError(userOnlyWithoutFileSize.error)) {
        return [];
    }
    throw userOnlyWithoutFileSize.error;
}
async function safeExactCount(supabase, table, options = {}) {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    if (options.ownerOrUser && options.userId) {
        query = query.or(`owner_id.eq.${options.userId},user_id.eq.${options.userId}`);
    }
    else if (options.userId) {
        query = query.eq('user_id', options.userId);
    }
    if (options.featureFilter) {
        query = query.eq('feature', options.featureFilter);
    }
    if (options.featureValues && options.featureValues.length > 0) {
        query = query.in('feature', options.featureValues);
    }
    if (options.statuses && options.statuses.length > 0) {
        query = query.in('status', options.statuses);
    }
    const createdAtColumn = options.createdAtColumn || 'created_at';
    if (options.startIso && options.startIso !== EPOCH_START_ISO) {
        query = query.gte(createdAtColumn, options.startIso);
    }
    if (options.endIso) {
        query = query.lt(createdAtColumn, options.endIso);
    }
    const { count, error } = await query;
    if (error) {
        if (isSchemaDriftError(error))
            return 0;
        throw error;
    }
    return Number(count || 0);
}
async function safeTokenUsage(supabase, userId, window) {
    let query = supabase
        .from('au_model_usage')
        .select('total_tokens,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10000);
    if (window.window_start !== EPOCH_START_ISO) {
        query = query.gte('created_at', window.window_start);
    }
    if (window.window_end) {
        query = query.lt('created_at', window.window_end);
    }
    const { data, error } = await query;
    if (error) {
        if (isSchemaDriftError(error))
            return 0;
        throw error;
    }
    let total = 0;
    for (const row of data || []) {
        total += clampNonNegativeNumber(row?.total_tokens, 0);
    }
    return total;
}
function countDocumentsWithinWindow(documents, window) {
    if (window.window_start === EPOCH_START_ISO && !window.window_end) {
        return documents.length;
    }
    return documents.reduce((sum, row) => {
        return sum + (isWithinWindow(row.created_at, window.window_start, window.window_end) ? 1 : 0);
    }, 0);
}
async function getQuotaWindow(supabase, userId, metric, resetEveryDays) {
    const { start, end } = computeQuotaWindowBounds(resetEveryDays);
    const label = describeResetEveryDays(resetEveryDays);
    const { error } = await supabase
        .from('au_quota_windows')
        .upsert({
        user_id: userId,
        metric,
        window_start: start,
        window_end: end || FAR_FUTURE_END_ISO,
    }, { onConflict: 'user_id,metric' });
    if (error && !isSchemaDriftError(error)) {
        throw error;
    }
    return {
        metric,
        reset_every_days: resetEveryDays,
        window_start: start,
        window_end: end,
        label,
    };
}
async function buildUsageSnapshot(supabase, userId, canonicalLimits) {
    const windows = {
        tokens: await getQuotaWindow(supabase, userId, 'tokens', canonicalLimits.tokens_reset_every_days),
        chats: await getQuotaWindow(supabase, userId, 'chats', canonicalLimits.chats_reset_every_days),
        uploads: await getQuotaWindow(supabase, userId, 'uploads', canonicalLimits.uploads_reset_every_days),
        documents: await getQuotaWindow(supabase, userId, 'documents', canonicalLimits.documents_reset_every_days),
        exams: await getQuotaWindow(supabase, userId, 'exams', canonicalLimits.exams_reset_every_days),
        storage: await getQuotaWindow(supabase, userId, 'storage', canonicalLimits.storage_reset_every_days),
    };
    const [documentRows, runningJobs, chatsCount, examsCount, tokensUsed] = await Promise.all([
        safeSelectDocuments(supabase, userId),
        safeExactCount(supabase, 'au_worker_jobs', {
            userId,
            ownerOrUser: true,
            statuses: ['queued', 'uploaded', 'processing'],
            createdAtColumn: 'created_at',
        }),
        safeExactCount(supabase, 'au_messages', {
            userId,
            startIso: windows.chats.window_start,
            endIso: windows.chats.window_end,
        }),
        safeExactCount(supabase, 'au_feature_outputs', {
            userId,
            featureValues: ['exam_prediction', 'practice_exam_generation', 'practice_exam_generation_pack2'],
            startIso: windows.exams.window_start,
            endIso: windows.exams.window_end,
        }),
        safeTokenUsage(supabase, userId, windows.tokens),
    ]);
    const documentsCount = countDocumentsWithinWindow(documentRows, windows.documents);
    const uploadsCount = countDocumentsWithinWindow(documentRows, windows.uploads);
    const usedStorageBytes = documentRows.reduce((sum, row) => sum + clampNonNegativeNumber(row.file_size_bytes, 0), 0);
    const usedStorageMb = Math.ceil(usedStorageBytes / ONE_MB_BYTES);
    return {
        today: {
            used_chats: chatsCount,
            messages_count: chatsCount,
            used_uploads: uploadsCount,
            uploads_count: uploadsCount,
            used_documents: documentsCount,
            documents_count: documentsCount,
            used_exams: examsCount,
            exams_count: examsCount,
            used_tokens: tokensUsed,
            tokens_used: tokensUsed,
        },
        total: {
            used_uploads: uploadsCount,
            uploads_count: uploadsCount,
            used_documents: documentsCount,
            documents_count: documentsCount,
            used_chats: chatsCount,
            messages_count: chatsCount,
            used_exams: examsCount,
            exams_count: examsCount,
            used_tokens: tokensUsed,
            tokens_used: tokensUsed,
            used_storage_mb: usedStorageMb,
            uploaded_mb: usedStorageMb,
            running_jobs: runningJobs,
            active_jobs: runningJobs,
        },
        reset_at: windows.tokens.window_end,
        windows,
        reset_policies: {
            tokens_reset_every_days: canonicalLimits.tokens_reset_every_days,
            chats_reset_every_days: canonicalLimits.chats_reset_every_days,
            uploads_reset_every_days: canonicalLimits.uploads_reset_every_days,
            documents_reset_every_days: canonicalLimits.documents_reset_every_days,
            exams_reset_every_days: canonicalLimits.exams_reset_every_days,
            storage_reset_every_days: canonicalLimits.storage_reset_every_days,
        },
    };
}
async function getEffectiveLimits(supabase, userId) {
    const effectivePlan = await resolveEffectivePlan(supabase, userId);
    const [planLimits, proUpload100Enabled] = await Promise.all([
        loadPlanLimits(supabase, effectivePlan.plan),
        isProUploadFlagEnabled(supabase),
    ]);
    const canonicalLimits = applyLimitOverrides(effectivePlan.plan, planLimits, proUpload100Enabled);
    const usage = await buildUsageSnapshot(supabase, userId, canonicalLimits);
    return {
        plan: effectivePlan.plan,
        effectivePlan,
        limits: withAliases(canonicalLimits),
        canonicalLimits,
        usage,
    };
}
function buildLimitPayload(params) {
    return {
        status: params.status,
        code: params.code,
        message: params.message,
        limit: params.limit,
        current: params.current,
        used: params.current,
        max: params.max,
        action: params.action,
        correlation_id: params.correlationId,
        reset_at: params.resetAt || null,
    };
}
function throwUploadLimitIfNeeded(input) {
    const { canonicalLimits, usage } = input.limits;
    const fileSizeMb = Math.ceil(input.fileSizeBytes / ONE_MB_BYTES);
    const usedStorageMb = clampNonNegativeNumber(usage.total.used_storage_mb, 0);
    const uploadsTotal = clampNonNegativeNumber(usage.total.used_uploads, 0);
    if (fileSizeMb > canonicalLimits.max_file_size_mb) {
        const sizeLimitMessage = canonicalLimits.max_file_size_mb <= 50 && fileSizeMb > 50
            ? large_file_gating_1.LARGE_FILE_DISABLED_MESSAGE
            : `File exceeds upload size limit (${canonicalLimits.max_file_size_mb}MB).`;
        throw new EffectiveLimitError(413, buildLimitPayload({
            status: 413,
            code: 'LIMIT_EXCEEDED',
            message: sizeLimitMessage,
            limit: 'max_file_size_mb',
            current: fileSizeMb,
            max: canonicalLimits.max_file_size_mb,
            action: 'upload_init',
            correlationId: input.correlationId,
        }));
    }
    if (uploadsTotal + 1 > canonicalLimits.max_uploads_total) {
        throw new EffectiveLimitError(403, buildLimitPayload({
            status: 403,
            code: 'LIMIT_REACHED',
            message: 'Upload quota reached for this account.',
            limit: 'max_uploads_total',
            current: uploadsTotal,
            max: canonicalLimits.max_uploads_total,
            action: 'upload_init',
            correlationId: input.correlationId,
            resetAt: usage.windows.uploads.window_end,
        }));
    }
    if (usedStorageMb + fileSizeMb > canonicalLimits.max_storage_mb) {
        throw new EffectiveLimitError(409, buildLimitPayload({
            status: 409,
            code: 'LIMIT_EXCEEDED',
            message: 'Storage quota would be exceeded by this upload.',
            limit: 'max_storage_mb',
            current: usedStorageMb,
            max: canonicalLimits.max_storage_mb,
            action: 'upload_init',
            correlationId: input.correlationId,
        }));
    }
}
function throwIngestLimitIfNeeded(input) {
    const { canonicalLimits, usage } = input.limits;
    const documentsTotal = clampNonNegativeNumber(usage.total.used_documents, 0);
    const runningJobs = clampNonNegativeNumber(usage.total.running_jobs, 0);
    if (documentsTotal + 1 > canonicalLimits.max_documents_total) {
        throw new EffectiveLimitError(403, buildLimitPayload({
            status: 403,
            code: 'LIMIT_REACHED',
            message: 'Document limit reached for this account.',
            limit: 'max_documents_total',
            current: documentsTotal,
            max: canonicalLimits.max_documents_total,
            action: 'document_ingest',
            correlationId: input.correlationId,
            resetAt: usage.windows.documents.window_end,
        }));
    }
    if (runningJobs >= canonicalLimits.max_concurrent_jobs) {
        throw new EffectiveLimitError(429, buildLimitPayload({
            status: 429,
            code: 'LIMIT_REACHED',
            message: 'Too many active jobs. Retry after an active job completes.',
            limit: 'max_concurrent_jobs',
            current: runningJobs,
            max: canonicalLimits.max_concurrent_jobs,
            action: 'document_ingest',
            correlationId: input.correlationId,
        }), { 'retry-after': '60' });
    }
}
function throwChatLimitIfNeeded(input) {
    const { canonicalLimits, usage } = input.limits;
    const chatsTotal = clampNonNegativeNumber(usage.total.used_chats, 0);
    const tokensUsed = clampNonNegativeNumber(usage.total.used_tokens, 0);
    if (chatsTotal + 1 > canonicalLimits.max_chats_total) {
        throw new EffectiveLimitError(403, buildLimitPayload({
            status: 403,
            code: 'LIMIT_REACHED',
            message: 'Chat limit reached for this account.',
            limit: 'max_chats_total',
            current: chatsTotal,
            max: canonicalLimits.max_chats_total,
            action: 'chat',
            correlationId: input.correlationId,
            resetAt: usage.windows.chats.window_end,
        }));
    }
    if (tokensUsed >= canonicalLimits.max_tokens_total) {
        throw new EffectiveLimitError(429, buildLimitPayload({
            status: 429,
            code: 'TOKEN_BUDGET_EXCEEDED',
            message: 'Token budget exceeded for the current quota window. Retry after reset.',
            limit: 'max_tokens_total',
            current: tokensUsed,
            max: canonicalLimits.max_tokens_total,
            action: 'chat',
            correlationId: input.correlationId,
            resetAt: usage.windows.tokens.window_end,
        }), { 'retry-after': '3600' });
    }
}
function throwExamLimitIfNeeded(input) {
    const { canonicalLimits, usage } = input.limits;
    const examsTotal = clampNonNegativeNumber(usage.total.used_exams, 0);
    if (examsTotal + 1 > canonicalLimits.max_exams_total) {
        throw new EffectiveLimitError(403, buildLimitPayload({
            status: 403,
            code: 'LIMIT_REACHED',
            message: 'Exam generation limit reached for this account.',
            limit: 'max_exams_total',
            current: examsTotal,
            max: canonicalLimits.max_exams_total,
            action: input.action || 'exam_generation',
            correlationId: input.correlationId,
            resetAt: usage.windows.exams.window_end,
        }));
    }
}
