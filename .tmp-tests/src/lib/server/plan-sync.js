"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPlanTransition = applyPlanTransition;
const crypto_1 = require("crypto");
const subscription_policy_1 = require("../plans/subscription-policy");
const transitionQueue = new Map();
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function isMissingRpcError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return (code === '42883' ||
        (message.includes('function') && message.includes('does not exist')) ||
        (message.includes('schema cache') && message.includes('function')));
}
function normalizeSubscription(input) {
    if (!input)
        return {};
    return {
        plan_key: input.planKey ?? null,
        status: input.status ?? null,
        paystack_subscription_code: input.paystackSubscriptionCode ?? null,
        paystack_email_token: input.paystackEmailToken ?? null,
        starts_at: input.startsAt ?? null,
        ends_at: input.endsAt ?? null,
        cancel_at_period_end: input.cancelAtPeriodEnd === true,
        metadata: input.metadata || {},
    };
}
async function applyFallbackPlanTransition(supabase, input) {
    const tier = input.normalizedPlan === 'free' ? 'free' : input.normalizedPlan;
    const expiresAt = input.entitlementEndsAt ?? null;
    const entitlementMetadata = {
        ...(input.metadata || {}),
        last_transition_source: input.source,
        last_transition_reason: input.reason || null,
        last_transition_trace_id: input.traceId,
        current_expiration_days: (0, subscription_policy_1.resolvePlanExpirationDays)({
            plan: input.normalizedPlan,
            entitlementSource: input.normalizedEntitlementSource,
        }),
    };
    const entitlementWrite = await supabase
        .from('au_user_entitlements')
        .upsert({
        user_id: input.userId,
        plan: input.normalizedPlan,
        source: input.normalizedEntitlementSource,
        expires_at: expiresAt,
        metadata: entitlementMetadata,
    }, { onConflict: 'user_id' });
    if (entitlementWrite.error)
        throw entitlementWrite.error;
    const profileWrite = await supabase
        .from('au_user_profiles')
        .upsert({
        user_id: input.userId,
        tier,
        tier_expires_at: expiresAt,
    }, { onConflict: 'user_id' });
    if (profileWrite.error)
        throw profileWrite.error;
    const subscription = normalizeSubscription(input.subscription);
    if (Object.keys(subscription).length > 0) {
        const subscriptionWrite = await supabase
            .from('billing_subscriptions')
            .upsert({
            user_id: input.userId,
            ...subscription,
        }, { onConflict: 'user_id' });
        if (subscriptionWrite.error)
            throw subscriptionWrite.error;
    }
    const auditWrite = await supabase.from('entitlement_audit').insert({
        user_id: input.userId,
        action: `plan_transition:${input.normalizedTransitionKind}`,
        before_json: null,
        after_json: {
            plan: input.normalizedPlan,
            entitlement_source: input.normalizedEntitlementSource,
            expires_at: expiresAt,
        },
        source: input.source,
        trace_id: input.traceId,
    });
    if (auditWrite.error)
        throw auditWrite.error;
    return {
        changed: true,
        plan: input.normalizedPlan,
        entitlementSource: input.normalizedEntitlementSource,
        expiresAt,
        transitionKind: input.normalizedTransitionKind,
        documentsUpdated: 0,
        traceId: input.traceId,
    };
}
async function runPlanTransition(supabase, input) {
    const normalizedPlan = (0, subscription_policy_1.normalizeManagedPlan)(input.targetPlan);
    const normalizedEntitlementSource = (0, subscription_policy_1.normalizeEntitlementSource)(input.entitlementSource);
    const traceId = String(input.traceId || (0, crypto_1.randomUUID)());
    const normalizedTransitionKind = input.transitionKind ||
        (0, subscription_policy_1.resolvePlanTransitionKind)({
            previousPlan: null,
            previousEntitlementSource: null,
            nextPlan: normalizedPlan,
            nextEntitlementSource: normalizedEntitlementSource,
        });
    const rpcPayload = {
        p_user_id: input.userId,
        p_target_plan: normalizedPlan,
        p_entitlement_source: normalizedEntitlementSource,
        p_entitlement_expires_at: input.entitlementEndsAt ?? null,
        p_transition_kind: normalizedTransitionKind,
        p_transition_source: input.source,
        p_reason: input.reason ?? null,
        p_trace_id: traceId,
        p_metadata: input.metadata || {},
        p_subscription: normalizeSubscription(input.subscription),
    };
    const { data, error } = await supabase.rpc('apply_plan_transition', rpcPayload);
    if (error) {
        if (isMissingRpcError(error)) {
            return applyFallbackPlanTransition(supabase, {
                ...input,
                traceId,
                normalizedPlan,
                normalizedEntitlementSource,
                normalizedTransitionKind,
            });
        }
        throw error;
    }
    const row = asRecord(data);
    return {
        changed: row.changed !== false,
        plan: (0, subscription_policy_1.normalizeManagedPlan)(String(row.plan || normalizedPlan)),
        entitlementSource: (0, subscription_policy_1.normalizeEntitlementSource)(String(row.entitlement_source || normalizedEntitlementSource)),
        expiresAt: typeof row.expires_at === 'string' ? row.expires_at : (input.entitlementEndsAt ?? null),
        transitionKind: (0, subscription_policy_1.resolvePlanTransitionKind)({
            previousPlan: String(row.previous_plan || ''),
            previousEntitlementSource: String(row.previous_entitlement_source || ''),
            nextPlan: String(row.plan || normalizedPlan),
            nextEntitlementSource: String(row.entitlement_source || normalizedEntitlementSource),
        }),
        documentsUpdated: Number(row.documents_updated || 0),
        traceId,
    };
}
async function applyPlanTransition(supabase, input) {
    const previous = transitionQueue.get(input.userId) || Promise.resolve({
        changed: false,
        plan: (0, subscription_policy_1.normalizeManagedPlan)(input.targetPlan),
        entitlementSource: (0, subscription_policy_1.normalizeEntitlementSource)(input.entitlementSource),
        expiresAt: input.entitlementEndsAt ?? null,
        transitionKind: input.transitionKind || 'sync',
        documentsUpdated: 0,
        traceId: String(input.traceId || ''),
    });
    const next = previous
        .catch(() => undefined)
        .then(() => runPlanTransition(supabase, input));
    transitionQueue.set(input.userId, next);
    try {
        return await next;
    }
    finally {
        if (transitionQueue.get(input.userId) === next) {
            transitionQueue.delete(input.userId);
        }
    }
}
