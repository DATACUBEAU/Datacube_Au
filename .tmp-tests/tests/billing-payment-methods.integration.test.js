"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const billing_plan_catalog_js_1 = require("../src/lib/server/billing-plan-catalog.js");
const payment_gateway_js_1 = require("../src/lib/payments/payment-gateway.js");
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
function simulateCheckout(input) {
    const plan = (0, billing_plan_catalog_js_1.materializeBillingPlanRow)({ planKeyRaw: input.requestedPlanKey });
    if (!plan || !plan.is_active) {
        return { ok: false, error: 'plan_not_available' };
    }
    if (!(0, payment_gateway_js_1.isPaymentMethodSupportedForGateway)(input.gateway, input.requestedPaymentMethod)) {
        return {
            ok: false,
            error: 'payment_method_not_supported',
            defaultPaymentMethod: (0, payment_gateway_js_1.getDefaultPaymentMethodForGateway)(input.gateway),
        };
    }
    return {
        ok: true,
        plan,
        effectivePaymentMethod: (0, payment_gateway_js_1.coercePaymentMethodForGateway)(input.gateway, input.requestedPaymentMethod),
    };
}
function simulateVerification(input) {
    const recoveredPlanKey = (0, billing_plan_catalog_js_1.materializeBillingPlanRow)({ planKeyRaw: input.metadataPlanKey })?.plan_key ||
        (0, billing_plan_catalog_js_1.resolveBillingPlanKeyByAmount)(input.amountKobo);
    const plan = (0, billing_plan_catalog_js_1.materializeBillingPlanRow)({ planKeyRaw: recoveredPlanKey });
    if (!plan) {
        return { ok: false, error: 'payment_plan_unresolvable' };
    }
    const effectivePaymentMethod = (0, payment_gateway_js_1.coercePaymentMethodForGateway)(input.gateway, input.requestedPaymentMethod);
    return {
        ok: true,
        planKey: plan.plan_key,
        effectivePaymentMethod,
        createsSubscription: effectivePaymentMethod === 'subscription',
    };
}
async function main() {
    await run('Paystack subscription checkout resolves a recurring monthly plan end to end', () => {
        const checkout = simulateCheckout({
            gateway: 'paystack',
            requestedPlanKey: 'pro_monthly',
            requestedPaymentMethod: 'subscription',
        });
        strict_1.default.equal(checkout.ok, true);
        if (!checkout.ok)
            return;
        strict_1.default.equal(checkout.plan.plan_key, 'pro_monthly');
        strict_1.default.equal(checkout.effectivePaymentMethod, 'subscription');
        const verification = simulateVerification({
            gateway: 'paystack',
            metadataPlanKey: checkout.plan.plan_key,
            amountKobo: checkout.plan.amount_kobo,
            requestedPaymentMethod: checkout.effectivePaymentMethod,
        });
        strict_1.default.equal(verification.ok, true);
        if (!verification.ok)
            return;
        strict_1.default.equal(verification.planKey, 'pro_monthly');
        strict_1.default.equal(verification.createsSubscription, true);
    });
    await run('Paystack transfer checkout resolves a one-time weekly payment path', () => {
        const checkout = simulateCheckout({
            gateway: 'paystack',
            requestedPlanKey: 'weekly',
            requestedPaymentMethod: 'transfer',
        });
        strict_1.default.equal(checkout.ok, true);
        if (!checkout.ok)
            return;
        strict_1.default.equal(checkout.plan.plan_key, 'pro_weekly');
        strict_1.default.equal(checkout.effectivePaymentMethod, 'transfer');
        const verification = simulateVerification({
            gateway: 'paystack',
            metadataPlanKey: checkout.plan.plan_key,
            amountKobo: checkout.plan.amount_kobo,
            requestedPaymentMethod: checkout.effectivePaymentMethod,
        });
        strict_1.default.equal(verification.ok, true);
        if (!verification.ok)
            return;
        strict_1.default.equal(verification.planKey, 'pro_weekly');
        strict_1.default.equal(verification.createsSubscription, false);
    });
    await run('Flutterwave transfer checkout stays on the manual-renew path', () => {
        const checkout = simulateCheckout({
            gateway: 'flutterwave',
            requestedPlanKey: 'monthly_pro',
            requestedPaymentMethod: 'transfer',
        });
        strict_1.default.equal(checkout.ok, true);
        if (!checkout.ok)
            return;
        strict_1.default.equal(checkout.plan.plan_key, 'pro_monthly');
        strict_1.default.equal(checkout.effectivePaymentMethod, 'transfer');
        const verification = simulateVerification({
            gateway: 'flutterwave',
            amountKobo: checkout.plan.amount_kobo,
            requestedPaymentMethod: checkout.effectivePaymentMethod,
        });
        strict_1.default.equal(verification.ok, true);
        if (!verification.ok)
            return;
        strict_1.default.equal(verification.planKey, 'pro_monthly');
        strict_1.default.equal(verification.createsSubscription, false);
    });
    await run('Flutterwave subscription requests are rejected at checkout and coerced to manual handling during recovery', () => {
        const checkout = simulateCheckout({
            gateway: 'flutterwave',
            requestedPlanKey: 'pro_monthly',
            requestedPaymentMethod: 'subscription',
        });
        strict_1.default.equal(checkout.ok, false);
        if (checkout.ok)
            return;
        strict_1.default.equal(checkout.error, 'payment_method_not_supported');
        strict_1.default.equal(checkout.defaultPaymentMethod, 'transfer');
        const verification = simulateVerification({
            gateway: 'flutterwave',
            amountKobo: 450000,
            requestedPaymentMethod: 'subscription',
        });
        strict_1.default.equal(verification.ok, true);
        if (!verification.ok)
            return;
        strict_1.default.equal(verification.planKey, 'pro_monthly');
        strict_1.default.equal(verification.effectivePaymentMethod, 'transfer');
        strict_1.default.equal(verification.createsSubscription, false);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
