"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const subscription_state_js_1 = require("../src/lib/billing/subscription-state.js");
const plans_js_1 = require("../src/lib/billing/plans.js");
const billing_config_js_1 = require("../src/lib/server/billing-config.js");
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
const CHECKOUT_ENABLED = {
    enabled: true,
    gateway: 'paystack',
    code: null,
    message: null,
};
const CHECKOUT_DISABLED = {
    enabled: false,
    gateway: 'paystack',
    code: 'paystack_env_missing',
    message: 'Paystack checkout is not configured on the server.',
};
function withEnv(overrides, fn) {
    const previous = new Map();
    for (const [key, value] of Object.entries(overrides)) {
        previous.set(key, process.env[key]);
        if (value == null) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    try {
        fn();
    }
    finally {
        for (const [key, value] of previous.entries()) {
            if (value == null) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    }
}
async function main() {
    await run('plan alias normalization maps legacy identifiers to canonical billing keys', () => {
        strict_1.default.equal((0, plans_js_1.normalizeCanonicalBillingPlanKey)('paid'), 'pro');
        strict_1.default.equal((0, plans_js_1.normalizeCanonicalBillingPlanKey)('monthly_pro'), 'pro_monthly');
        strict_1.default.equal((0, plans_js_1.normalizeCanonicalBillingPlanKey)('weekly-pro'), 'pro_weekly');
        strict_1.default.equal((0, plans_js_1.normalizeBillingManagedPlan)('premium'), 'premium');
    });
    await run('active Pro Monthly card renders as current plan', () => {
        const state = (0, subscription_state_js_1.deriveNormalizedSubscriptionState)({
            effectivePlan: 'pro',
            entitlementSource: 'paid',
            subscriptionPlanKey: 'monthly_pro',
            subscriptionStatus: 'active',
        });
        const monthlyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_monthly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        });
        const weeklyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_weekly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        });
        strict_1.default.equal(state.activePlanKey, 'pro_monthly');
        strict_1.default.equal((0, subscription_state_js_1.resolvePlanStatusLabelFromState)(state), 'Pro');
        strict_1.default.equal(monthlyCard.isCurrent, true);
        strict_1.default.equal(monthlyCard.ctaLabel, 'MANAGE PLAN');
        strict_1.default.equal(monthlyCard.disabled, true);
        strict_1.default.equal(weeklyCard.isCurrent, false);
        strict_1.default.equal(weeklyCard.action, 'select');
    });
    await run('active Pro Weekly card renders as current plan', () => {
        const state = (0, subscription_state_js_1.deriveNormalizedSubscriptionState)({
            effectivePlan: 'pro',
            entitlementSource: 'paid',
            legacyTier: 'weekly',
        });
        const weeklyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_weekly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        });
        const monthlyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_monthly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        });
        strict_1.default.equal(state.activePlanKey, 'pro_weekly');
        strict_1.default.equal(state.currentPlanLabel, 'Pro Weekly');
        strict_1.default.equal(weeklyCard.isCurrent, true);
        strict_1.default.equal(weeklyCard.ctaLabel, 'CURRENT PLAN');
        strict_1.default.equal(monthlyCard.isCurrent, false);
        strict_1.default.equal(monthlyCard.action, 'select');
    });
    await run('missing subscription authority stays pending instead of silently becoming free', () => {
        const state = (0, subscription_state_js_1.deriveNormalizedSubscriptionState)({});
        const freeCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'free',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        });
        strict_1.default.equal(state.managedPlan, 'free');
        strict_1.default.equal(state.isAuthoritative, false);
        strict_1.default.equal(state.resolutionSource, 'unknown');
        strict_1.default.equal(state.activePlanKey, null);
        strict_1.default.equal(state.currentPlanLabel, 'Plan pending');
        strict_1.default.equal(freeCard.isCurrent, false);
        strict_1.default.equal(freeCard.ctaLabel, 'PLAN LOADING');
        strict_1.default.equal(freeCard.disabled, true);
    });
    await run('clicking the active plan never reaches checkout init', () => {
        const state = (0, subscription_state_js_1.deriveNormalizedSubscriptionState)({
            effectivePlan: 'pro',
            entitlementSource: 'paid',
            subscriptionPlanKey: 'pro_monthly',
            subscriptionStatus: 'active',
        });
        let checkoutInitCalls = 0;
        if ((0, subscription_state_js_1.canStartCheckoutForPlan)({
            planKey: 'pro_monthly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        })) {
            checkoutInitCalls += 1;
        }
        strict_1.default.equal(checkoutInitCalls, 0);
    });
    await run('missing PAYSTACK_SECRET_KEY returns a safe typed billing error response', () => {
        withEnv({
            PAYSTACK_SECRET_KEY: undefined,
            PAYSTACK_SECRET: undefined,
        }, () => {
            let error = null;
            try {
                (0, billing_config_js_1.assertBillingGatewayCapability)({
                    gateway: 'paystack',
                    action: 'checkout_initialize',
                });
            }
            catch (caught) {
                error = caught;
            }
            strict_1.default.ok(error instanceof billing_config_js_1.BillingConfigurationError);
            const serialized = (0, billing_config_js_1.serializeBillingApiError)(error, {
                status: 400,
                code: 'checkout_failed',
                message: 'Checkout failed.',
                requestId: 'req-billing-test',
            });
            strict_1.default.equal(serialized.status, 503);
            strict_1.default.equal(serialized.body.error, 'billing_gateway_not_configured');
            strict_1.default.equal(serialized.body.requestId, 'req-billing-test');
            strict_1.default.deepEqual(serialized.body.details?.missingEnv, ['PAYSTACK_SECRET_KEY']);
        });
    });
    await run('PAYSTACK_SECRET_KEY enables paystack billing without requiring a client key', () => {
        withEnv({
            PAYSTACK_SECRET_KEY: 'sk_live_server_only',
            PAYSTACK_SECRET: undefined,
            NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: undefined,
        }, () => {
            const capability = (0, billing_config_js_1.assertBillingGatewayCapability)({
                gateway: 'paystack',
                action: 'checkout_initialize',
            });
            strict_1.default.equal(capability.enabled, true);
        });
    });
    await run('client public key alone does not satisfy server paystack billing requirements', () => {
        withEnv({
            PAYSTACK_SECRET_KEY: undefined,
            PAYSTACK_SECRET: undefined,
            NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: 'pk_live_public_only',
        }, () => {
            let error = null;
            try {
                (0, billing_config_js_1.assertBillingGatewayCapability)({
                    gateway: 'paystack',
                    action: 'checkout_initialize',
                });
            }
            catch (caught) {
                error = caught;
            }
            strict_1.default.ok(error instanceof billing_config_js_1.BillingConfigurationError);
        });
    });
    await run('frontend keeps the active plan non-selectable when checkout initialization fails', () => {
        const state = (0, subscription_state_js_1.deriveNormalizedSubscriptionState)({
            effectivePlan: 'pro',
            entitlementSource: 'paid',
            subscriptionPlanKey: 'pro_monthly',
            subscriptionStatus: 'active',
        });
        const monthlyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_monthly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_DISABLED,
        });
        const weeklyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_weekly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_DISABLED,
        });
        strict_1.default.equal(monthlyCard.action, 'manage');
        strict_1.default.equal(monthlyCard.ctaLabel, 'MANAGE PLAN');
        strict_1.default.equal(monthlyCard.disabled, true);
        strict_1.default.equal(weeklyCard.action, 'unavailable');
        strict_1.default.equal(weeklyCard.ctaLabel, 'UNAVAILABLE');
    });
    await run('sidebar label and pricing cards stay aligned from the normalized subscription state', () => {
        const state = (0, subscription_state_js_1.deriveNormalizedSubscriptionState)({
            effectivePlan: 'pro',
            entitlementSource: 'paid',
            subscriptionPlanKey: 'pro_weekly',
            subscriptionStatus: 'active',
        });
        const weeklyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_weekly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        });
        const monthlyCard = (0, subscription_state_js_1.buildSubscriptionCardState)({
            planKey: 'pro_monthly',
            state,
            canAccessBilling: true,
            checkout: CHECKOUT_ENABLED,
        });
        strict_1.default.equal((0, subscription_state_js_1.resolvePlanStatusLabelFromState)(state), 'Pro');
        strict_1.default.equal(weeklyCard.isCurrent, true);
        strict_1.default.equal(monthlyCard.isCurrent, false);
        strict_1.default.equal(state.currentPlanLabel, 'Pro Weekly');
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
