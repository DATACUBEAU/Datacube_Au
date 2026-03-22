"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSubscriptionStatus = normalizeSubscriptionStatus;
exports.isActiveSubscriptionStatus = isActiveSubscriptionStatus;
exports.deriveNormalizedSubscriptionState = deriveNormalizedSubscriptionState;
exports.buildSubscriptionCardState = buildSubscriptionCardState;
exports.canStartCheckoutForPlan = canStartCheckoutForPlan;
exports.resolvePlanStatusLabelFromState = resolvePlanStatusLabelFromState;
const plans_1 = require("./plans");
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'non_renewing']);
function normalizeSubscriptionStatus(raw) {
    const value = String(raw || '').trim().toLowerCase();
    return value || null;
}
function isActiveSubscriptionStatus(raw) {
    const status = normalizeSubscriptionStatus(raw);
    return Boolean(status && ACTIVE_SUBSCRIPTION_STATUSES.has(status));
}
function deriveNormalizedSubscriptionState(input) {
    const hasAuthorityInput = typeof input.promoActive === 'boolean' ||
        String(input.effectivePlan ?? '').trim().length > 0 ||
        String(input.entitlementSource ?? '').trim().length > 0 ||
        String(input.subscriptionPlanKey ?? '').trim().length > 0 ||
        String(input.subscriptionStatus ?? '').trim().length > 0 ||
        String(input.latestPaymentPlanKey ?? '').trim().length > 0 ||
        String(input.legacyTier ?? '').trim().length > 0;
    const effectivePlan = (0, plans_1.normalizeEffectiveEntitlementPlan)(input.effectivePlan);
    const entitlementSource = (0, plans_1.normalizeBillingEntitlementSource)(input.entitlementSource);
    const promoActive = input.promoActive === true || entitlementSource === 'promo';
    const subscriptionStatus = normalizeSubscriptionStatus(input.subscriptionStatus);
    const hasActiveSubscription = isActiveSubscriptionStatus(subscriptionStatus);
    const subscriptionPlanKey = (0, plans_1.normalizeCanonicalBillingPlanKey)(input.subscriptionPlanKey);
    const latestPaymentPlanKey = (0, plans_1.normalizeCanonicalBillingPlanKey)(input.latestPaymentPlanKey);
    const legacyPlanKey = (0, plans_1.normalizeCanonicalBillingPlanKey)(input.legacyTier);
    const managedPlan = (() => {
        if (effectivePlan === 'admin' || effectivePlan === 'premium')
            return 'premium';
        if (effectivePlan === 'pro' || effectivePlan === 'promo_pro')
            return 'pro';
        const legacyManagedPlan = (0, plans_1.normalizeBillingManagedPlan)(input.legacyTier);
        return legacyManagedPlan;
    })();
    let activePlanKey = null;
    let resolutionSource = hasAuthorityInput ? 'free' : 'unknown';
    if (!hasAuthorityInput) {
        activePlanKey = null;
        resolutionSource = 'unknown';
    }
    else if (promoActive) {
        activePlanKey = managedPlan === 'premium' ? 'premium' : 'pro';
        resolutionSource = 'promo';
    }
    else if (managedPlan === 'premium') {
        activePlanKey = 'premium';
        resolutionSource = effectivePlan === 'premium' || effectivePlan === 'admin' ? 'effective_plan' : 'legacy_tier';
    }
    else if (hasActiveSubscription && subscriptionPlanKey) {
        activePlanKey = subscriptionPlanKey;
        resolutionSource = 'subscription';
    }
    else if (latestPaymentPlanKey) {
        activePlanKey = latestPaymentPlanKey;
        resolutionSource = 'transaction';
    }
    else if (legacyPlanKey && legacyPlanKey !== 'free') {
        activePlanKey = legacyPlanKey;
        resolutionSource = 'legacy_tier';
    }
    else if (managedPlan === 'pro' || entitlementSource === 'paid') {
        activePlanKey = 'pro';
        resolutionSource = effectivePlan === 'pro' || effectivePlan === 'promo_pro' ? 'effective_plan' : 'legacy_tier';
    }
    else {
        activePlanKey = 'free';
        resolutionSource = 'free';
    }
    return {
        managedPlan,
        effectivePlan,
        entitlementSource,
        isAuthoritative: hasAuthorityInput,
        promoActive,
        hasPaidEntitlement: entitlementSource === 'paid',
        hasPromoEntitlement: promoActive,
        hasManagedPaidPlan: managedPlan !== 'free',
        activePlanKey,
        activeInterval: (0, plans_1.normalizeBillingInterval)(activePlanKey),
        subscriptionStatus,
        hasActiveSubscription,
        resolutionSource,
        currentPlanLabel: resolutionSource === 'unknown'
            ? 'Plan pending'
            : (0, plans_1.formatBillingPlanLabel)(activePlanKey || (managedPlan === 'premium' ? 'premium' : managedPlan === 'pro' ? 'pro' : 'free')),
    };
}
function isCurrentCardPlan(state, planKey) {
    if (planKey === 'free') {
        return state.managedPlan === 'free' && !state.hasPromoEntitlement;
    }
    return state.hasPaidEntitlement && state.activePlanKey === planKey;
}
function hasGenericManagedProPlan(state) {
    return state.managedPlan === 'pro' && state.hasPaidEntitlement && state.activePlanKey === 'pro';
}
function buildSubscriptionCardState(input) {
    const { planKey, state, canAccessBilling, checkout } = input;
    if (!state.isAuthoritative) {
        return {
            planKey,
            isCurrent: false,
            disabled: true,
            action: 'unavailable',
            ctaLabel: 'PLAN LOADING',
            reason: 'Plan details are still restoring from the server.',
        };
    }
    if (planKey === 'free') {
        const isCurrent = isCurrentCardPlan(state, 'free');
        return {
            planKey,
            isCurrent,
            disabled: true,
            action: 'current',
            ctaLabel: isCurrent ? 'CURRENT PLAN' : 'FREE PLAN',
            reason: null,
        };
    }
    const isCurrent = isCurrentCardPlan(state, planKey);
    if (isCurrent) {
        return {
            planKey,
            isCurrent: true,
            disabled: true,
            action: state.hasActiveSubscription ? 'manage' : 'current',
            ctaLabel: state.hasActiveSubscription ? 'MANAGE PLAN' : 'CURRENT PLAN',
            reason: 'This plan is already active on your account.',
        };
    }
    if (hasGenericManagedProPlan(state)) {
        return {
            planKey,
            isCurrent: false,
            disabled: true,
            action: state.hasActiveSubscription ? 'manage' : 'current',
            ctaLabel: state.hasActiveSubscription ? 'MANAGE PLAN' : 'CURRENT PLAN',
            reason: 'Your active Pro plan is already attached to this account.',
        };
    }
    if (state.managedPlan === 'premium') {
        return {
            planKey,
            isCurrent: false,
            disabled: true,
            action: 'unavailable',
            ctaLabel: 'MANAGE PLAN',
            reason: 'Premium subscriptions are managed separately.',
        };
    }
    if (state.hasPromoEntitlement) {
        return {
            planKey,
            isCurrent: false,
            disabled: true,
            action: 'unavailable',
            ctaLabel: 'PROMO ACTIVE',
            reason: 'Checkout is paused while promo Pro access is active.',
        };
    }
    if (!canAccessBilling) {
        return {
            planKey,
            isCurrent: false,
            disabled: true,
            action: 'unavailable',
            ctaLabel: 'BILLING UNAVAILABLE',
            reason: 'Billing is currently unavailable.',
        };
    }
    if (!checkout.enabled) {
        return {
            planKey,
            isCurrent: false,
            disabled: true,
            action: 'unavailable',
            ctaLabel: 'UNAVAILABLE',
            reason: checkout.message || 'Checkout is temporarily unavailable.',
        };
    }
    return {
        planKey,
        isCurrent: false,
        disabled: false,
        action: 'select',
        ctaLabel: 'SELECT PLAN',
        reason: null,
    };
}
function canStartCheckoutForPlan(input) {
    return buildSubscriptionCardState(input).action === 'select';
}
function resolvePlanStatusLabelFromState(state) {
    if (!state.isAuthoritative)
        return 'Plan pending';
    if (state.effectivePlan === 'admin')
        return 'Admin';
    if (state.managedPlan === 'premium')
        return 'Premium';
    if (state.hasPromoEntitlement)
        return 'Promo Pro';
    if (state.hasPaidEntitlement && state.managedPlan === 'pro')
        return 'Pro';
    return 'Free';
}
