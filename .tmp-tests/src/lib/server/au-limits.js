"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EffectiveLimitError = exports.DEFAULT_PLAN_METADATA = exports.DEFAULT_PLAN_ORDER = exports.DEFAULT_PLAN_LIMITS = void 0;
exports.resolveEffectivePlan = resolveEffectivePlan;
exports.resolveEffectivePlanFromInputs = resolveEffectivePlanFromInputs;
exports.loadPlanLimitRules = loadPlanLimitRules;
exports.loadPlanLimits = loadPlanLimits;
exports.resolveEffectivePlanLimitSnapshot = resolveEffectivePlanLimitSnapshot;
exports.loadPlanMetadata = loadPlanMetadata;
exports.loadPublicPlanCatalog = loadPublicPlanCatalog;
exports.buildZeroUsageSnapshot = buildZeroUsageSnapshot;
exports.buildUsageSnapshotForUser = buildUsageSnapshotForUser;
exports.getEffectiveLimits = getEffectiveLimits;
exports.resolveCanonicalEffectiveLimits = resolveCanonicalEffectiveLimits;
exports.throwUploadLimitIfNeeded = throwUploadLimitIfNeeded;
exports.throwIngestLimitIfNeeded = throwIngestLimitIfNeeded;
exports.throwChatLimitIfNeeded = throwChatLimitIfNeeded;
exports.throwExamPredictionLimitIfNeeded = throwExamPredictionLimitIfNeeded;
exports.throwPracticeExamLimitIfNeeded = throwPracticeExamLimitIfNeeded;
exports.throwKnowledgeHubLimitIfNeeded = throwKnowledgeHubLimitIfNeeded;
exports.loadAdminPlanLimitState = loadAdminPlanLimitState;
exports.savePlanLimitScopeRules = savePlanLimitScopeRules;
exports.toStoredPlanRuleSetForScope = toStoredPlanRuleSetForScope;
exports.serializeEffectivePlanLimitRule = serializeEffectivePlanLimitRule;
exports.serializeStoredPlanLimitRule = serializeStoredPlanLimitRule;
exports.describeLimitScope = describeLimitScope;
const effective_entitlements_1 = require("@/lib/server/effective-entitlements");
const plan_limit_model_1 = require("@/lib/limits/plan-limit-model");
Object.defineProperty(exports, "DEFAULT_PLAN_LIMITS", { enumerable: true, get: function () { return plan_limit_model_1.DEFAULT_PLAN_LIMITS; } });
Object.defineProperty(exports, "DEFAULT_PLAN_ORDER", { enumerable: true, get: function () { return plan_limit_model_1.DEFAULT_PLAN_ORDER; } });
const subscription_policy_1 = require("@/lib/plans/subscription-policy");
const large_file_gating_1 = require("@/lib/upload/large-file-gating");
const document_usage_query_1 = require("@/lib/server/document-usage-query");
const usage_tracking_1 = require("@/lib/server/usage-tracking");
const ONE_MB_BYTES = 1024 * 1024;
exports.DEFAULT_PLAN_METADATA = {
    free: {
        label: 'Free',
        description: 'Core study tools with daily AI quotas and capped stored uploads.',
        price_display: 'NGN 0',
        monthly_amount_ngn: 0,
        monthly_compare_at_ngn: null,
        monthly_badge: '',
        weekly_amount_ngn: 0,
        weekly_compare_at_ngn: null,
        weekly_badge: '',
        feature_bullets: ['Document chat', 'Stored upload cap', 'Knowledge Hub access', 'Basic support'],
        cta_label: 'Current plan',
        cta_href: '/dashboard',
        sort_order: 0,
        retention_days: subscription_policy_1.FREE_PLAN_EXPIRATION_DAYS,
        expiration_days: subscription_policy_1.FREE_PLAN_EXPIRATION_DAYS,
    },
    pro: {
        label: 'Pro',
        description: 'Higher quotas for chat, tokens, uploads, and advanced study generation workflows.',
        price_display: 'NGN 4,500/month or NGN 1,500/week',
        monthly_amount_ngn: 4500,
        monthly_compare_at_ngn: 6000,
        monthly_badge: 'Save 25%',
        weekly_amount_ngn: 1500,
        weekly_compare_at_ngn: 2500,
        weekly_badge: 'Save 40%',
        feature_bullets: ['Knowledge Hub', 'Exam Prediction Engine', 'Practice exams', 'Higher runtime caps'],
        cta_label: 'Upgrade now',
        cta_href: '/dashboard/settings/subscription',
        sort_order: 1,
        retention_days: subscription_policy_1.PAID_PRO_PLAN_EXPIRATION_DAYS,
        expiration_days: subscription_policy_1.PAID_PRO_PLAN_EXPIRATION_DAYS,
    },
    premium: {
        label: 'Premium',
        description: 'Custom higher-volume workspace with expanded quotas and concurrency.',
        price_display: 'Custom pricing',
        monthly_amount_ngn: null,
        monthly_compare_at_ngn: null,
        monthly_badge: '',
        weekly_amount_ngn: null,
        weekly_compare_at_ngn: null,
        weekly_badge: '',
        feature_bullets: ['Everything in Pro', 'Higher concurrency', 'More stored outputs', 'Custom support'],
        cta_label: 'Contact admin',
        cta_href: 'https://wa.me/2349036553377',
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
        code.startsWith('PGRST') ||
        message.includes('does not exist') ||
        details.includes('does not exist') ||
        message.includes('schema cache') ||
        details.includes('schema cache') ||
        message.includes('could not find'));
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
    if (raw === 'pro' || raw === 'promo_pro' || raw === 'weekly' || raw === 'monthly' || raw === 'paid')
        return 'pro';
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
function normalizePlanMetadata(plan, input) {
    const source = asRecord(input);
    const defaults = exports.DEFAULT_PLAN_METADATA[plan];
    const minPaidRetentionDays = plan === 'pro' || plan === 'premium' ? subscription_policy_1.PAID_PRO_PLAN_EXPIRATION_DAYS : 0;
    const retentionDays = clampNonNegativeNumber(source.retention_days ?? source.retentionDays, defaults.retention_days);
    const expirationDays = clampNonNegativeNumber(source.expiration_days ?? source.expirationDays, defaults.expiration_days);
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
        retention_days: Math.max(minPaidRetentionDays, retentionDays),
        expiration_days: Math.max(minPaidRetentionDays, expirationDays),
    };
}
function featureBulletsJson(featureBullets) {
    return featureBullets.map((value) => String(value || '').trim()).filter(Boolean);
}
function buildRuleRowPayload(scope, rule) {
    return {
        scope,
        limit_key: rule.key,
        value: rule.value,
        mode: rule.mode,
        reset_policy: rule.resetPolicy,
        reset_interval_value: rule.resetIntervalValue,
        reset_interval_unit: rule.resetIntervalUnit,
        is_enabled: rule.isEnabled,
        is_unlimited: rule.isUnlimited,
        updated_at: new Date().toISOString(),
    };
}
function mapRuleRow(row) {
    const key = String(row.limit_key || '').trim();
    if (!plan_limit_model_1.APPROVED_LIMIT_KEYS.includes(key))
        return null;
    return (0, plan_limit_model_1.normalizeStoredPlanLimitRule)(key, {
        value: row.value,
        mode: row.mode,
        reset_policy: row.reset_policy,
        reset_interval_value: row.reset_interval_value,
        reset_interval_unit: row.reset_interval_unit,
        isEnabled: row.is_enabled,
        isUnlimited: row.is_unlimited,
        updated_at: row.updated_at,
    }, (0, plan_limit_model_1.buildDefaultPlanLimitRule)(key));
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
            const { error: insertError } = await supabase.from('au_plans').insert({ plan, is_default: plan === 'free' });
            if (insertError && String(insertError?.code || '') !== '23505')
                throw insertError;
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
        if (insertError && String(insertError?.code || '') !== '23505')
            throw insertError;
    }
}
async function seedApprovedLimitRules(supabase) {
    const countRes = await supabase.from('au_plan_limit_rules').select('scope', { count: 'exact', head: true });
    if (countRes.error) {
        if (isSchemaDriftError(countRes.error))
            return false;
        throw countRes.error;
    }
    if (Number(countRes.count || 0) > 0)
        return true;
    const payload = [];
    const legacyRuleSets = await Promise.all(plan_limit_model_1.DEFAULT_PLAN_ORDER.map((plan) => loadLegacyPlanRuleSet(supabase, plan)));
    const foundLegacy = legacyRuleSets.some((entry) => entry.found);
    const defaultRules = foundLegacy ? legacyRuleSets[0].rules : (0, plan_limit_model_1.buildDefaultRuleSet)();
    for (const rule of Object.values(defaultRules)) {
        payload.push(buildRuleRowPayload('default', rule));
    }
    for (const plan of plan_limit_model_1.DEFAULT_PLAN_ORDER) {
        const planRules = foundLegacy
            ? legacyRuleSets.find((entry, index) => plan_limit_model_1.DEFAULT_PLAN_ORDER[index] === plan)?.rules || (0, plan_limit_model_1.buildSeedPlanRuleSet)(plan)
            : (0, plan_limit_model_1.buildSeedPlanRuleSet)(plan);
        for (const key of plan_limit_model_1.APPROVED_LIMIT_KEYS) {
            if (plan === 'free')
                continue;
            const rule = planRules[key];
            if (!rule || (0, plan_limit_model_1.arePlanLimitRulesEqual)(rule, defaultRules[key]))
                continue;
            payload.push(buildRuleRowPayload(plan, rule));
        }
    }
    const { error } = await supabase.from('au_plan_limit_rules').upsert(payload, { onConflict: 'scope,limit_key' });
    if (error) {
        if (isSchemaDriftError(error))
            return false;
        throw error;
    }
    return true;
}
function applyLegacyResetPolicy(key, base, rawDays) {
    const days = clampNonNegativeNumber(rawDays, 0);
    if (days <= 0) {
        const defaultMode = key === 'max_uploads_total'
            ? 'current'
            : key === 'max_knowledge_hub'
                ? 'current'
                : (0, plan_limit_model_1.normalizePlanLimitMode)(base.mode, 'usage');
        return (0, plan_limit_model_1.normalizeStoredPlanLimitRule)(key, {
            ...base,
            mode: defaultMode,
            reset_policy: 'never',
        }, base);
    }
    return (0, plan_limit_model_1.normalizeStoredPlanLimitRule)(key, {
        ...base,
        mode: 'usage',
        reset_policy: days === 1 ? 'daily' : 'custom',
        reset_interval_value: days === 1 ? null : days,
        reset_interval_unit: days === 1 ? null : 'day',
    }, base);
}
function legacyRowToRuleSet(plan, row) {
    const seeded = (0, plan_limit_model_1.buildSeedPlanRuleSet)(plan);
    const examCap = clampNonNegativeNumber(row.max_exam_predictions ?? row.max_practice_exams ?? row.max_exams_total, seeded.max_exam_predictions.value ?? 0);
    const knowledgeCap = clampNonNegativeNumber(row.max_knowledge_hub ?? row.max_documents_total ?? row.max_docs_total ?? row.max_uploads_total, seeded.max_knowledge_hub.value ?? 0);
    const mapped = {
        max_chats_total: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_chats_total', { ...seeded.max_chats_total, value: row.max_chats_total ?? row.max_messages_per_day }, seeded.max_chats_total),
        max_uploads_total: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_uploads_total', { ...seeded.max_uploads_total, value: row.max_uploads_total }, seeded.max_uploads_total),
        max_tokens_total: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_tokens_total', { ...seeded.max_tokens_total, value: row.max_tokens_total ?? row.max_tokens_per_day }, seeded.max_tokens_total),
        max_file_size_mb: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_file_size_mb', { ...seeded.max_file_size_mb, value: row.max_file_size_mb ?? row.max_file_mb }, seeded.max_file_size_mb),
        max_concurrent_jobs: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_concurrent_jobs', { ...seeded.max_concurrent_jobs, value: row.max_concurrent_jobs ?? row.max_jobs_concurrent }, seeded.max_concurrent_jobs),
        max_exam_predictions: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_exam_predictions', { ...seeded.max_exam_predictions, value: examCap }, seeded.max_exam_predictions),
        max_practice_exams: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_practice_exams', { ...seeded.max_practice_exams, value: examCap }, seeded.max_practice_exams),
        max_knowledge_hub: (0, plan_limit_model_1.normalizeStoredPlanLimitRule)('max_knowledge_hub', { ...seeded.max_knowledge_hub, value: knowledgeCap }, seeded.max_knowledge_hub),
    };
    mapped.max_chats_total = applyLegacyResetPolicy('max_chats_total', mapped.max_chats_total, row.chats_reset_every_days);
    mapped.max_tokens_total = applyLegacyResetPolicy('max_tokens_total', mapped.max_tokens_total, row.tokens_reset_every_days);
    mapped.max_uploads_total = applyLegacyResetPolicy('max_uploads_total', mapped.max_uploads_total, row.uploads_reset_every_days);
    mapped.max_exam_predictions = applyLegacyResetPolicy('max_exam_predictions', mapped.max_exam_predictions, row.exams_reset_every_days);
    mapped.max_practice_exams = applyLegacyResetPolicy('max_practice_exams', mapped.max_practice_exams, row.exams_reset_every_days);
    mapped.max_knowledge_hub = applyLegacyResetPolicy('max_knowledge_hub', mapped.max_knowledge_hub, row.documents_reset_every_days);
    return mapped;
}
async function loadLegacyPlanRuleSet(supabase, plan) {
    // Legacy columns are read only to migrate existing production values into the
    // canonical rule table when older environments have not been backfilled yet.
    const primary = await supabase
        .from('au_plan_limits')
        .select([
        'max_file_size_mb',
        'max_uploads_total',
        'max_documents_total',
        'max_chats_total',
        'max_exams_total',
        'max_tokens_total',
        'max_concurrent_jobs',
        'tokens_reset_every_days',
        'chats_reset_every_days',
        'uploads_reset_every_days',
        'documents_reset_every_days',
        'exams_reset_every_days',
    ].join(','))
        .eq('plan', plan)
        .maybeSingle();
    if (!primary.error && primary.data) {
        return {
            rules: legacyRowToRuleSet(plan, primary.data),
            found: true,
        };
    }
    if (primary.error && !isSchemaDriftError(primary.error))
        throw primary.error;
    const fallback = await supabase
        .from('plan_limits')
        .select('limits,effective_from')
        .eq('plan', plan)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!fallback.error && fallback.data?.limits) {
        return {
            rules: legacyRowToRuleSet(plan, fallback.data.limits),
            found: true,
        };
    }
    return {
        rules: (0, plan_limit_model_1.buildSeedPlanRuleSet)(plan),
        found: false,
    };
}
async function loadPlanLimitCatalog(supabase) {
    const defaultRules = (0, plan_limit_model_1.buildDefaultRuleSet)();
    const emptyOverrides = plan_limit_model_1.DEFAULT_PLAN_ORDER.reduce((acc, plan) => {
        acc[plan] = {};
        return acc;
    }, {});
    const emptyStoredScopes = plan_limit_model_1.PLAN_LIMIT_SCOPE_KEYS.reduce((acc, scope) => {
        acc[scope] = {};
        return acc;
    }, {});
    const seeded = await seedApprovedLimitRules(supabase).catch(() => false);
    if (seeded) {
        const { data, error } = await supabase
            .from('au_plan_limit_rules')
            .select('scope,limit_key,value,mode,reset_policy,reset_interval_value,reset_interval_unit,is_enabled,is_unlimited,updated_at');
        if (error) {
            if (!isSchemaDriftError(error))
                throw error;
        }
        else {
            const storedRulesByScope = { ...emptyStoredScopes };
            const defaultMerged = { ...defaultRules };
            for (const raw of (data || [])) {
                const scope = String(raw.scope || '').trim().toLowerCase();
                if (!plan_limit_model_1.PLAN_LIMIT_SCOPE_KEYS.includes(scope))
                    continue;
                const mapped = mapRuleRow(raw);
                if (!mapped)
                    continue;
                storedRulesByScope[scope][mapped.key] = mapped;
                if (scope === 'default') {
                    defaultMerged[mapped.key] = mapped;
                }
            }
            const overridesByPlan = { ...emptyOverrides };
            for (const plan of plan_limit_model_1.DEFAULT_PLAN_ORDER) {
                for (const key of plan_limit_model_1.APPROVED_LIMIT_KEYS) {
                    const rule = storedRulesByScope[plan][key];
                    if (rule)
                        overridesByPlan[plan][key] = rule;
                }
            }
            const effectiveRulesByPlan = plan_limit_model_1.DEFAULT_PLAN_ORDER.reduce((acc, plan) => {
                acc[plan] = (0, plan_limit_model_1.mergePlanLimitRuleSets)({
                    scope: plan,
                    defaultRules: defaultMerged,
                    overrides: overridesByPlan[plan],
                });
                return acc;
            }, {});
            return {
                source: 'au_plan_limit_rules',
                defaultRules: defaultMerged,
                overridesByPlan,
                effectiveRulesByPlan,
                storedRulesByScope,
            };
        }
    }
    let foundLegacy = false;
    const effectiveRulesByPlan = {};
    for (const plan of plan_limit_model_1.DEFAULT_PLAN_ORDER) {
        const legacy = await loadLegacyPlanRuleSet(supabase, plan);
        foundLegacy = foundLegacy || legacy.found;
        effectiveRulesByPlan[plan] = (0, plan_limit_model_1.mergePlanLimitRuleSets)({
            scope: plan,
            defaultRules,
            overrides: plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
                const legacyRule = legacy.rules[key];
                if (plan !== 'free')
                    acc[key] = legacyRule;
                return acc;
            }, {}),
        });
    }
    return {
        source: foundLegacy ? 'legacy_plan_limits' : 'seed_defaults',
        defaultRules,
        overridesByPlan: emptyOverrides,
        effectiveRulesByPlan,
        storedRulesByScope: emptyStoredScopes,
    };
}
async function resolveEffectivePlan(supabase, userId) {
    const [entitlementRes, profileRes, entitlements] = await Promise.all([
        supabase.from('au_user_entitlements').select('plan,source,expires_at').eq('user_id', userId).maybeSingle(),
        supabase.from('au_user_profiles').select('tier').eq('user_id', userId).maybeSingle(),
        (0, effective_entitlements_1.getEffectiveEntitlementsSnapshot)(supabase, userId).catch(() => null),
    ]);
    return resolveEffectivePlanFromInputs({
        profileTier: profileRes.data?.tier,
        mirroredPlan: !entitlementRes.error ? entitlementRes.data?.plan : null,
        mirroredSource: entitlementRes.data?.source,
        mirroredExpiresAt: typeof entitlementRes.data?.expires_at === 'string'
            ? String(entitlementRes.data.expires_at)
            : null,
        entitlementPlan: entitlements?.plan ?? null,
        entitlementSource: entitlements?.entitlementSource ?? null,
        entitlementEndsAt: entitlements?.entitlementEndsAt ?? null,
    });
}
function resolveEffectivePlanFromInputs(input) {
    const profileTierRaw = String(input.profileTier || '').trim().toLowerCase();
    const profileInfo = normalizeProfileTier(input.profileTier);
    const mirroredPlanRaw = String(input.mirroredPlan || '').trim().toLowerCase();
    const mirroredPlan = mirroredPlanRaw && mirroredPlanRaw !== 'promo_pro' ? normalizePlan(mirroredPlanRaw) : null;
    const mirroredSource = (0, subscription_policy_1.normalizeEntitlementSource)(typeof input.mirroredSource === 'string' ? input.mirroredSource : null);
    const mirroredExpiresAt = typeof input.mirroredExpiresAt === 'string' ? input.mirroredExpiresAt : null;
    const entitlementPlanRaw = String(input.entitlementPlan || '').trim().toLowerCase();
    const entitlementPlan = entitlementPlanRaw && entitlementPlanRaw !== 'promo_pro' ? normalizePlan(entitlementPlanRaw) : null;
    const entitlementSource = (0, subscription_policy_1.normalizeEntitlementSource)(typeof input.entitlementSource === 'string' ? input.entitlementSource : null);
    const entitlementEndsAt = typeof input.entitlementEndsAt === 'string' ? input.entitlementEndsAt : null;
    const hasPaidBillingPlan = entitlementSource === 'paid' && entitlementPlan === 'pro';
    const hasPromoOnlyAccess = entitlementSource === 'promo' ||
        entitlementPlanRaw === 'promo_pro' ||
        mirroredPlanRaw === 'promo_pro' ||
        profileTierRaw === 'promo_pro';
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
    if (hasPaidBillingPlan) {
        return {
            plan: entitlementPlan || 'pro',
            isAdmin: false,
            hasPro: true,
            source: 'billing',
            entitlementSource,
            expiresAt: entitlementEndsAt,
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
    if (hasPromoOnlyAccess) {
        return {
            plan: 'free',
            isAdmin: false,
            hasPro: false,
            source: 'billing',
            entitlementSource: 'promo',
            expiresAt: entitlementEndsAt,
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
function normalizeOptionalUserId(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}
function buildPlanOverrideEffectivePlan(plan) {
    return {
        plan,
        isAdmin: false,
        hasPro: plan !== 'free',
        source: 'default',
        entitlementSource: plan === 'free' ? 'none' : 'paid',
        expiresAt: null,
    };
}
async function loadPlanLimitRules(supabase, plan) {
    const catalog = await loadPlanLimitCatalog(supabase);
    return catalog.effectiveRulesByPlan[plan];
}
async function loadPlanLimits(supabase, plan) {
    const rules = await loadPlanLimitRules(supabase, plan);
    return (0, plan_limit_model_1.ruleSetToNumericLimits)(rules);
}
function serializePlanLimitPresentation(display) {
    return {
        cap_label: display.capLabel,
        mode_label: display.modeLabel,
        reset_label: display.resetLabel,
        reset_description: display.resetDescription,
        summary: display.summary,
    };
}
async function resolveEffectivePlanLimitSnapshot(input) {
    const limitRules = await loadPlanLimitRules(input.supabase, input.plan);
    const usage = input.userId
        ? await buildUsageSnapshotForUser(input.supabase, input.userId, limitRules)
        : buildZeroUsageSnapshot(limitRules);
    return {
        plan: input.plan,
        limits: (0, plan_limit_model_1.ruleSetToNumericLimits)(limitRules),
        limitRules,
        usage,
    };
}
async function loadPlanMetadata(supabase, plan) {
    await ensurePlanSeedRow(supabase, 'au_plans', plan).catch(() => undefined);
    await ensurePlanSeedRow(supabase, 'au_plan_metadata', plan).catch(() => undefined);
    const res = await supabase
        .from('au_plan_metadata')
        .select('label,description,price_display,monthly_amount_ngn,monthly_compare_at_ngn,monthly_badge,weekly_amount_ngn,weekly_compare_at_ngn,weekly_badge,feature_bullets,cta_label,cta_href,sort_order,retention_days,expiration_days')
        .eq('plan', plan)
        .maybeSingle();
    if (!res.error && res.data)
        return normalizePlanMetadata(plan, res.data);
    if (res.error && !isSchemaDriftError(res.error))
        throw res.error;
    return { ...exports.DEFAULT_PLAN_METADATA[plan] };
}
function toPricingPoint(amount, compareAt, label, planKey) {
    if (amount === null || amount === undefined || amount <= 0)
        return null;
    return { amount, compare_at: compareAt, label, plan_key: planKey };
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
        out[intervalRaw] = { amount: Math.max(0, amount), plan_key: planKey };
    }
    return out;
}
async function loadPublicPlanCatalog(supabase) {
    const [plansRes, pricingRows] = await Promise.all([
        supabase.from('au_plans').select('plan,is_default'),
        loadBillingPricingRows(supabase).catch(() => ({})),
    ]);
    const planRows = !plansRes.error && plansRes.data?.length
        ? plansRes.data
        : plan_limit_model_1.DEFAULT_PLAN_ORDER.map((plan) => ({ plan, is_default: plan === 'free' }));
    const entries = await Promise.all(plan_limit_model_1.DEFAULT_PLAN_ORDER.map(async (plan) => {
        const metadata = await loadPlanMetadata(supabase, plan);
        const snapshot = await resolveEffectivePlanLimitSnapshot({ supabase, plan });
        const limitRules = snapshot.limitRules;
        const limits = snapshot.limits;
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
            limits,
            limitRules,
            resetLabels: plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
                acc[key] = snapshot.usage.windows[key]?.label || (0, plan_limit_model_1.describeResetPolicy)(limitRules[key]);
                return acc;
            }, {}),
        };
    }));
    return entries.sort((a, b) => {
        if (a.metadata.sort_order !== b.metadata.sort_order)
            return a.metadata.sort_order - b.metadata.sort_order;
        return plan_limit_model_1.DEFAULT_PLAN_ORDER.indexOf(a.plan) - plan_limit_model_1.DEFAULT_PLAN_ORDER.indexOf(b.plan);
    });
}
async function safeExactCount(supabase, table, options = {}) {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    if (options.ownerOrUser && options.userId) {
        query = query.or(`owner_id.eq.${options.userId},user_id.eq.${options.userId}`);
    }
    else if (options.userId) {
        query = query.eq('user_id', options.userId);
    }
    if (options.featureFilter)
        query = query.eq('feature', options.featureFilter);
    if (options.featureValues && options.featureValues.length > 0)
        query = query.in('feature', options.featureValues);
    if (options.statuses && options.statuses.length > 0)
        query = query.in('status', options.statuses);
    const createdAtColumn = options.createdAtColumn || 'created_at';
    if (options.startIso)
        query = query.gte(createdAtColumn, options.startIso);
    if (options.endIso)
        query = query.lt(createdAtColumn, options.endIso);
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
    query = query.gte('created_at', window.windowStart);
    if (window.windowEnd)
        query = query.lt('created_at', window.windowEnd);
    const { data, error } = await query;
    if (error) {
        if (isSchemaDriftError(error))
            return 0;
        throw error;
    }
    return (data || []).reduce((sum, row) => sum + clampNonNegativeNumber(row?.total_tokens, 0), 0);
}
function isCountedDocument(row) {
    return String(row.status || '').trim().toLowerCase() !== 'failed';
}
function countCurrentDocuments(rows) {
    return rows.reduce((sum, row) => sum + (isCountedDocument(row) ? 1 : 0), 0);
}
function countDocumentsWithinWindow(rows, window) {
    return rows.reduce((sum, row) => {
        if (!isCountedDocument(row))
            return sum;
        const createdAt = row.created_at;
        if (!createdAt || createdAt < window.windowStart)
            return sum;
        if (window.windowEnd && createdAt >= window.windowEnd)
            return sum;
        return sum + 1;
    }, 0);
}
function buildZeroUsageSnapshot(limitRules) {
    const by_limit = plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const window = (0, plan_limit_model_1.computeResetWindow)(limitRules[key]);
        acc[key] = {
            key,
            used: 0,
            limit: (0, plan_limit_model_1.getLimitCap)(limitRules[key]),
            remaining: (0, plan_limit_model_1.getLimitCap)(limitRules[key]),
            state: limitRules[key].state,
            mode: limitRules[key].mode,
            label: limitRules[key].label,
            description: limitRules[key].description,
            category: limitRules[key].category,
            reset: {
                policy: window.policy,
                intervalValue: window.intervalValue,
                intervalUnit: window.intervalUnit,
                window_start: window.windowStart,
                window_end: window.windowEnd,
                label: window.label,
            },
        };
        return acc;
    }, {});
    const windows = plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        acc[key] = by_limit[key].reset;
        return acc;
    }, {});
    return {
        today: plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
            acc[key] = 0;
            return acc;
        }, {}),
        total: plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
            acc[key] = 0;
            return acc;
        }, {}),
        by_limit,
        windows,
        reset_policies: plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
            acc[key] = by_limit[key].reset.policy;
            return acc;
        }, {}),
        reset_at: plan_limit_model_1.APPROVED_LIMIT_KEYS
            .map((key) => by_limit[key].reset.window_end)
            .filter((value) => Boolean(value))
            .sort()[0] || null,
    };
}
async function buildUsageSnapshotForUser(supabase, userId, limitRules) {
    const uploadWindow = (0, plan_limit_model_1.computeResetWindow)(limitRules.max_uploads_total);
    const predictionWindow = (0, plan_limit_model_1.computeResetWindow)(limitRules.max_exam_predictions);
    const practiceWindow = (0, plan_limit_model_1.computeResetWindow)(limitRules.max_practice_exams);
    const knowledgeWindow = (0, plan_limit_model_1.computeResetWindow)(limitRules.max_knowledge_hub);
    const chatWindow = (0, plan_limit_model_1.computeResetWindow)(limitRules.max_chats_total);
    const tokenWindow = (0, plan_limit_model_1.computeResetWindow)(limitRules.max_tokens_total);
    const [documentRows, runningJobs, legacyChatsCount, legacyTokensUsed, predictionWindowCount, predictionCurrentCount, practiceWindowCount, practiceCurrentCount, knowledgeWindowCount, knowledgeCurrentCount, trackedSnapshots,] = await Promise.all([
        (0, document_usage_query_1.safeSelectDocuments)(supabase, userId),
        safeExactCount(supabase, 'au_worker_jobs', {
            userId,
            ownerOrUser: true,
            statuses: ['queued', 'uploaded', 'processing'],
        }),
        safeExactCount(supabase, 'au_messages', {
            userId,
            startIso: chatWindow.windowStart,
            endIso: chatWindow.windowEnd,
        }),
        safeTokenUsage(supabase, userId, tokenWindow),
        safeExactCount(supabase, 'au_feature_outputs', {
            userId,
            featureValues: ['exam_prediction'],
            statuses: ['ready', 'running'],
            startIso: predictionWindow.windowStart,
            endIso: predictionWindow.windowEnd,
        }),
        safeExactCount(supabase, 'au_feature_outputs', {
            userId,
            featureValues: ['exam_prediction'],
            statuses: ['ready', 'running'],
        }),
        safeExactCount(supabase, 'au_feature_outputs', {
            userId,
            featureValues: ['practice_exam_generation', 'practice_exam_generation_pack2'],
            statuses: ['ready', 'running'],
            startIso: practiceWindow.windowStart,
            endIso: practiceWindow.windowEnd,
        }),
        safeExactCount(supabase, 'au_feature_outputs', {
            userId,
            featureValues: ['practice_exam_generation', 'practice_exam_generation_pack2'],
            statuses: ['ready', 'running'],
        }),
        safeExactCount(supabase, 'au_feature_outputs', {
            userId,
            featureValues: ['knowledge_hub'],
            statuses: ['ready', 'running'],
            startIso: knowledgeWindow.windowStart,
            endIso: knowledgeWindow.windowEnd,
        }),
        safeExactCount(supabase, 'au_feature_outputs', {
            userId,
            featureValues: ['knowledge_hub'],
            statuses: ['ready', 'running'],
        }),
        (0, usage_tracking_1.loadUsageCounterSnapshots)(supabase, userId).catch(() => ({ today: {}, total: {} })),
    ]);
    const currentUploads = countCurrentDocuments(documentRows);
    const windowUploads = countDocumentsWithinWindow(documentRows, uploadWindow);
    const [trackedChats, trackedTokens, trackedUploads, trackedPredictions, trackedPractice, trackedKnowledge,] = await Promise.all([
        (0, usage_tracking_1.resolveUsageMetricForRule)({
            supabase,
            userId,
            metricKey: 'max_chats_total',
            rule: limitRules.max_chats_total,
            fallbackUsed: legacyChatsCount,
            todayCounters: trackedSnapshots.today,
            totalCounters: trackedSnapshots.total,
        }),
        (0, usage_tracking_1.resolveUsageMetricForRule)({
            supabase,
            userId,
            metricKey: 'max_tokens_total',
            rule: limitRules.max_tokens_total,
            fallbackUsed: legacyTokensUsed,
            todayCounters: trackedSnapshots.today,
            totalCounters: trackedSnapshots.total,
        }),
        (0, usage_tracking_1.resolveUsageMetricForRule)({
            supabase,
            userId,
            metricKey: 'max_uploads_total',
            rule: limitRules.max_uploads_total,
            fallbackUsed: limitRules.max_uploads_total.mode === 'current' ? currentUploads : windowUploads,
            todayCounters: trackedSnapshots.today,
            totalCounters: trackedSnapshots.total,
        }),
        (0, usage_tracking_1.resolveUsageMetricForRule)({
            supabase,
            userId,
            metricKey: 'max_exam_predictions',
            rule: limitRules.max_exam_predictions,
            fallbackUsed: limitRules.max_exam_predictions.mode === 'current' ? predictionCurrentCount : predictionWindowCount,
            todayCounters: trackedSnapshots.today,
            totalCounters: trackedSnapshots.total,
        }),
        (0, usage_tracking_1.resolveUsageMetricForRule)({
            supabase,
            userId,
            metricKey: 'max_practice_exams',
            rule: limitRules.max_practice_exams,
            fallbackUsed: limitRules.max_practice_exams.mode === 'current' ? practiceCurrentCount : practiceWindowCount,
            todayCounters: trackedSnapshots.today,
            totalCounters: trackedSnapshots.total,
        }),
        (0, usage_tracking_1.resolveUsageMetricForRule)({
            supabase,
            userId,
            metricKey: 'max_knowledge_hub',
            rule: limitRules.max_knowledge_hub,
            fallbackUsed: limitRules.max_knowledge_hub.mode === 'current' ? knowledgeCurrentCount : knowledgeWindowCount,
            todayCounters: trackedSnapshots.today,
            totalCounters: trackedSnapshots.total,
        }),
    ]);
    const totals = {
        max_chats_total: trackedChats.effectiveUsed,
        max_uploads_total: trackedUploads.effectiveUsed,
        max_tokens_total: trackedTokens.effectiveUsed,
        max_file_size_mb: 0,
        max_concurrent_jobs: runningJobs,
        max_exam_predictions: trackedPredictions.effectiveUsed,
        max_practice_exams: trackedPractice.effectiveUsed,
        max_knowledge_hub: trackedKnowledge.effectiveUsed,
    };
    const by_limit = plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const window = (0, plan_limit_model_1.computeResetWindow)(limitRules[key]);
        const cap = (0, plan_limit_model_1.getLimitCap)(limitRules[key]);
        const used = totals[key];
        acc[key] = {
            key,
            used,
            limit: cap,
            remaining: cap === null ? null : Math.max(0, cap - used),
            state: limitRules[key].state,
            mode: limitRules[key].mode,
            label: limitRules[key].label,
            description: limitRules[key].description,
            category: limitRules[key].category,
            reset: {
                policy: window.policy,
                intervalValue: window.intervalValue,
                intervalUnit: window.intervalUnit,
                window_start: window.windowStart,
                window_end: window.windowEnd,
                label: window.label,
            },
        };
        return acc;
    }, {});
    const windows = plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        acc[key] = by_limit[key].reset;
        return acc;
    }, {});
    return {
        today: { ...totals },
        total: { ...totals },
        by_limit,
        windows,
        reset_policies: plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
            acc[key] = by_limit[key].reset.policy;
            return acc;
        }, {}),
        reset_at: plan_limit_model_1.APPROVED_LIMIT_KEYS
            .map((key) => by_limit[key].reset.window_end)
            .filter((value) => Boolean(value))
            .sort()[0] || null,
    };
}
async function getEffectiveLimits(supabase, userId) {
    return resolveCanonicalEffectiveLimits({
        supabase,
        userId,
    });
}
async function resolveCanonicalEffectiveLimits(input) {
    const userId = normalizeOptionalUserId(input.userId);
    const effectivePlan = input.planOverride
        ? buildPlanOverrideEffectivePlan(input.planOverride)
        : userId
            ? await resolveEffectivePlan(input.supabase, userId)
            : null;
    if (!effectivePlan) {
        throw new Error('resolveCanonicalEffectiveLimits requires either a userId or planOverride.');
    }
    const snapshot = await resolveEffectivePlanLimitSnapshot({
        supabase: input.supabase,
        plan: effectivePlan.plan,
        userId,
    });
    return {
        plan: effectivePlan.plan,
        effectivePlan,
        limits: snapshot.limits,
        limitRules: snapshot.limitRules,
        usage: snapshot.usage,
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
        max: params.max ?? null,
        action: params.action,
        correlation_id: params.correlationId,
        reset_at: params.resetAt || null,
    };
}
function assertRuleEnabled(rule, action, correlationId, current = 0) {
    if (rule.isEnabled)
        return;
    throw new EffectiveLimitError(403, buildLimitPayload({
        status: 403,
        code: 'LIMIT_REACHED',
        message: `${rule.label} is disabled for this plan.`,
        limit: rule.key,
        current,
        max: (0, plan_limit_model_1.getLimitCap)(rule),
        action,
        correlationId,
        resetAt: null,
    }));
}
function assertUsageWithinCap(params) {
    const cap = (0, plan_limit_model_1.getLimitCap)(params.rule);
    assertRuleEnabled(params.rule, params.action, params.correlationId, params.used);
    if (cap === null)
        return;
    const nextUsed = params.used + (params.nextIncrement ?? 0);
    if (nextUsed <= cap)
        return;
    throw new EffectiveLimitError(params.status || 403, buildLimitPayload({
        status: params.status || 403,
        code: params.code || 'LIMIT_REACHED',
        message: params.message,
        limit: params.rule.key,
        current: params.used,
        max: cap,
        action: params.action,
        correlationId: params.correlationId,
        resetAt: params.resetAt ?? null,
    }), params.headers);
}
function throwUploadLimitIfNeeded(input) {
    const fileRule = input.limits.limitRules.max_file_size_mb;
    const uploadRule = input.limits.limitRules.max_uploads_total;
    const fileSizeMb = Math.ceil(input.fileSizeBytes / ONE_MB_BYTES);
    const cap = (0, plan_limit_model_1.getLimitCap)(fileRule);
    assertRuleEnabled(fileRule, 'upload_init', input.correlationId, fileSizeMb);
    if (cap !== null && fileSizeMb > cap) {
        throw new EffectiveLimitError(413, buildLimitPayload({
            status: 413,
            code: 'LIMIT_EXCEEDED',
            message: cap <= 50 && fileSizeMb > 50 ? large_file_gating_1.LARGE_FILE_DISABLED_MESSAGE : `File exceeds upload size limit (${cap}MB).`,
            limit: 'max_file_size_mb',
            current: fileSizeMb,
            max: cap,
            action: 'upload_init',
            correlationId: input.correlationId,
        }));
    }
    if (input.includeUploadCount !== false) {
        assertUsageWithinCap({
            rule: uploadRule,
            used: clampNonNegativeNumber(input.limits.usage.total.max_uploads_total, 0),
            nextIncrement: 1,
            action: 'upload_init',
            correlationId: input.correlationId,
            resetAt: input.limits.usage.by_limit.max_uploads_total.reset.window_end,
            message: uploadRule.mode === 'current'
                ? 'Stored upload limit reached for this account. Delete an upload before adding another.'
                : 'Upload quota reached for this account.',
        });
    }
}
function throwIngestLimitIfNeeded(input) {
    assertUsageWithinCap({
        rule: input.limits.limitRules.max_concurrent_jobs,
        used: clampNonNegativeNumber(input.limits.usage.total.max_concurrent_jobs, 0),
        nextIncrement: 0,
        action: 'document_ingest',
        correlationId: input.correlationId,
        message: 'Too many active jobs. Retry after an active job completes.',
        status: 429,
        headers: { 'retry-after': '60' },
    });
}
function throwChatLimitIfNeeded(input) {
    assertUsageWithinCap({
        rule: input.limits.limitRules.max_chats_total,
        used: clampNonNegativeNumber(input.limits.usage.total.max_chats_total, 0),
        nextIncrement: 1,
        action: 'chat',
        correlationId: input.correlationId,
        resetAt: input.limits.usage.by_limit.max_chats_total.reset.window_end,
        message: 'Chat limit reached for this account.',
    });
    assertUsageWithinCap({
        rule: input.limits.limitRules.max_tokens_total,
        used: clampNonNegativeNumber(input.limits.usage.total.max_tokens_total, 0),
        nextIncrement: Math.max(0, Math.floor(Number(input.tokenIncrement || 0))),
        action: 'chat',
        correlationId: input.correlationId,
        resetAt: input.limits.usage.by_limit.max_tokens_total.reset.window_end,
        message: 'Token budget exceeded for the current quota window. Retry after reset.',
        status: 429,
        code: 'TOKEN_BUDGET_EXCEEDED',
        headers: { 'retry-after': '3600' },
    });
}
function throwExamPredictionLimitIfNeeded(input) {
    assertUsageWithinCap({
        rule: input.limits.limitRules.max_exam_predictions,
        used: clampNonNegativeNumber(input.limits.usage.total.max_exam_predictions, 0),
        nextIncrement: 1,
        action: input.action || 'exam_prediction',
        correlationId: input.correlationId,
        resetAt: input.limits.usage.by_limit.max_exam_predictions.reset.window_end,
        message: 'Exam prediction limit reached for this account.',
    });
}
function throwPracticeExamLimitIfNeeded(input) {
    assertUsageWithinCap({
        rule: input.limits.limitRules.max_practice_exams,
        used: clampNonNegativeNumber(input.limits.usage.total.max_practice_exams, 0),
        nextIncrement: 1,
        action: input.action || 'practice_exam_generation',
        correlationId: input.correlationId,
        resetAt: input.limits.usage.by_limit.max_practice_exams.reset.window_end,
        message: 'Practice exam limit reached for this account.',
    });
}
function throwKnowledgeHubLimitIfNeeded(input) {
    assertUsageWithinCap({
        rule: input.limits.limitRules.max_knowledge_hub,
        used: clampNonNegativeNumber(input.limits.usage.total.max_knowledge_hub, 0),
        nextIncrement: 1,
        action: input.action || 'knowledge_hub',
        correlationId: input.correlationId,
        resetAt: input.limits.usage.by_limit.max_knowledge_hub.reset.window_end,
        message: input.limits.limitRules.max_knowledge_hub.mode === 'current'
            ? 'Knowledge Hub item limit reached for this account. Clear a stored item before generating another.'
            : 'Knowledge Hub generation limit reached for this account.',
    });
}
async function loadAdminPlanLimitState(supabase) {
    const catalog = await loadPlanLimitCatalog(supabase);
    return {
        source: catalog.source,
        defaultRules: catalog.defaultRules,
        storedRulesByScope: catalog.storedRulesByScope,
        effectiveRulesByPlan: catalog.effectiveRulesByPlan,
    };
}
async function savePlanLimitScopeRules(input) {
    const defaultRules = (0, plan_limit_model_1.buildDefaultRuleSet)();
    const removeKeys = plan_limit_model_1.APPROVED_LIMIT_KEYS.filter((key) => input.scope !== 'default' && !input.rules[key]);
    const upsertRows = plan_limit_model_1.APPROVED_LIMIT_KEYS
        .map((key) => input.rules[key])
        .filter((rule) => Boolean(rule))
        .map((rule) => buildRuleRowPayload(input.scope, rule));
    if (removeKeys.length > 0) {
        const deleteRes = await input.supabase.from('au_plan_limit_rules').delete().eq('scope', input.scope).in('limit_key', removeKeys);
        if (deleteRes.error) {
            if (isSchemaDriftError(deleteRes.error)) {
                throw new Error('Missing canonical plan-limits schema. Run `npm run supabase:db:push` to apply the latest backend migration before saving limits.');
            }
            throw deleteRes.error;
        }
    }
    if (upsertRows.length > 0) {
        const upsertRes = await input.supabase.from('au_plan_limit_rules').upsert(upsertRows, { onConflict: 'scope,limit_key' });
        if (upsertRes.error) {
            if (isSchemaDriftError(upsertRes.error)) {
                throw new Error('Missing canonical plan-limits schema. Run `npm run supabase:db:push` to apply the latest backend migration before saving limits.');
            }
            throw upsertRes.error;
        }
    }
    if (input.scope === 'default') {
        for (const key of plan_limit_model_1.APPROVED_LIMIT_KEYS) {
            if (!input.rules[key]) {
                const fallback = buildRuleRowPayload('default', defaultRules[key]);
                const fallbackRes = await input.supabase.from('au_plan_limit_rules').upsert(fallback, { onConflict: 'scope,limit_key' });
                if (fallbackRes.error && !isSchemaDriftError(fallbackRes.error))
                    throw fallbackRes.error;
            }
        }
    }
}
function toStoredPlanRuleSetForScope(input) {
    return plan_limit_model_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const raw = input.ruleInputs[key] || {};
        if (input.scope !== 'default' && raw.inheritsDefault) {
            acc[key] = null;
            return acc;
        }
        const normalized = (0, plan_limit_model_1.normalizeStoredPlanLimitRule)(key, raw, input.defaultRules[key]);
        if (input.scope !== 'default' &&
            normalized.value === input.defaultRules[key].value &&
            normalized.mode === input.defaultRules[key].mode &&
            normalized.resetPolicy === input.defaultRules[key].resetPolicy &&
            normalized.resetIntervalValue === input.defaultRules[key].resetIntervalValue &&
            normalized.resetIntervalUnit === input.defaultRules[key].resetIntervalUnit &&
            normalized.isEnabled === input.defaultRules[key].isEnabled &&
            normalized.isUnlimited === input.defaultRules[key].isUnlimited) {
            acc[key] = null;
            return acc;
        }
        acc[key] = normalized;
        return acc;
    }, {});
}
function serializeEffectivePlanLimitRule(rule) {
    const presentation = (0, plan_limit_model_1.buildPlanLimitPresentation)({
        value: rule.value,
        isEnabled: rule.isEnabled,
        isUnlimited: rule.isUnlimited,
        mode: rule.mode,
        resetPolicy: rule.resetPolicy,
        resetIntervalValue: rule.resetIntervalValue,
        resetIntervalUnit: rule.resetIntervalUnit,
        unitLabel: rule.unitLabel,
        category: rule.category,
    });
    return {
        key: rule.key,
        label: rule.label,
        description: rule.description,
        unit_label: rule.unitLabel,
        category: rule.category,
        value: rule.value,
        mode: rule.mode,
        reset_policy: rule.resetPolicy,
        reset_interval_value: rule.resetIntervalValue,
        reset_interval_unit: rule.resetIntervalUnit,
        is_enabled: rule.isEnabled,
        is_unlimited: rule.isUnlimited,
        state: rule.state,
        inherited: rule.inherited,
        source_scope: rule.sourceScope,
        updated_at: rule.updatedAt,
        enforced_by: [...rule.enforcedBy],
        presentation: serializePlanLimitPresentation(presentation),
    };
}
function serializeStoredPlanLimitRule(rule) {
    if (!rule)
        return null;
    const definition = plan_limit_model_1.PLAN_LIMIT_DEFINITIONS[rule.key];
    const presentation = (0, plan_limit_model_1.buildPlanLimitPresentation)({
        value: rule.value,
        isEnabled: rule.isEnabled,
        isUnlimited: rule.isUnlimited,
        mode: rule.mode,
        resetPolicy: rule.resetPolicy,
        resetIntervalValue: rule.resetIntervalValue,
        resetIntervalUnit: rule.resetIntervalUnit,
        unitLabel: definition.unitLabel,
        category: definition.category,
    });
    return {
        key: rule.key,
        label: definition.label,
        description: definition.description,
        unit_label: definition.unitLabel,
        category: definition.category,
        value: rule.value,
        mode: rule.mode,
        reset_policy: rule.resetPolicy,
        reset_interval_value: rule.resetIntervalValue,
        reset_interval_unit: rule.resetIntervalUnit,
        is_enabled: rule.isEnabled,
        is_unlimited: rule.isUnlimited,
        state: rule.isEnabled ? (rule.isUnlimited ? 'unlimited' : 'capped') : 'disabled',
        updated_at: rule.updatedAt,
        enforced_by: [...definition.enforcedBy],
        presentation: serializePlanLimitPresentation(presentation),
    };
}
function describeLimitScope(scope) {
    return (0, plan_limit_model_1.formatScopeLabel)(scope);
}
