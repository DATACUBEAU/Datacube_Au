"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const billing_plan_catalog_js_1 = require("../src/lib/server/billing-plan-catalog.js");
const billing_renewal_js_1 = require("../src/lib/server/billing-renewal.js");
const billing_session_js_1 = require("../src/lib/server/billing-session.js");
const billing_request_guard_js_1 = require("../src/lib/server/billing-request-guard.js");
const plan_refresh_state_js_1 = require("../src/lib/billing/plan-refresh-state.js");
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
function createMockResponse() {
    const cookies = new Map();
    const headers = new Map();
    return {
        cookies: {
            set(name, value, options) {
                cookies.set(name, { value, options });
            },
            get(name) {
                return cookies.get(name);
            },
        },
        headers: {
            set(name, value) {
                headers.set(name.toLowerCase(), value);
            },
            get(name) {
                return headers.get(name.toLowerCase()) ?? null;
            },
        },
    };
}
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
    await run('rotated Paystack plan codes are the canonical defaults', () => {
        strict_1.default.equal(billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_weekly, 'PLN_h3teb0z285iuyet');
        strict_1.default.equal(billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_monthly, 'PLN_bo7k3ulauwdhzjl');
        strict_1.default.equal(billing_plan_catalog_js_1.DEFAULT_BILLING_PLAN_CATALOG.find((plan) => plan.planKey === 'pro_weekly')?.fallbackPaystackPlanCode, billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_weekly);
        strict_1.default.equal(billing_plan_catalog_js_1.DEFAULT_BILLING_PLAN_CATALOG.find((plan) => plan.planKey === 'pro_monthly')?.fallbackPaystackPlanCode, billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_monthly);
    });
    await run('missing billing plan rows fall back to the default catalog without losing plan pricing', () => {
        const monthly = (0, billing_plan_catalog_js_1.materializeBillingPlanRow)({ planKeyRaw: 'monthly_pro' });
        const weekly = (0, billing_plan_catalog_js_1.materializeBillingPlanRow)({ planKeyRaw: 'weekly' });
        strict_1.default.deepEqual(monthly, {
            plan_key: 'pro_monthly',
            interval: 'monthly',
            amount_kobo: 450000,
            paystack_plan_code: billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_monthly,
            is_active: true,
            source: 'default_catalog',
        });
        strict_1.default.deepEqual(weekly, {
            plan_key: 'pro_weekly',
            interval: 'weekly',
            amount_kobo: 150000,
            paystack_plan_code: billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_weekly,
            is_active: true,
            source: 'default_catalog',
        });
    });
    await run('configured Paystack plan codes override stale database plan rows', () => {
        withEnv({
            PAYSTACK_PLAN_MONTHLY_CODE: 'PLN_live_monthly',
            PAYSTACK_PLAN_WEEKLY_CODE: 'PLN_live_weekly',
        }, () => {
            const monthly = (0, billing_plan_catalog_js_1.materializeBillingPlanRow)({
                planKeyRaw: 'pro_monthly',
                row: {
                    plan_key: 'pro_monthly',
                    interval: 'monthly',
                    amount_kobo: 450000,
                    paystack_plan_code: 'PLN_stale_monthly',
                    is_active: true,
                },
            });
            const weekly = (0, billing_plan_catalog_js_1.materializeBillingPlanRow)({
                planKeyRaw: 'pro_weekly',
                row: {
                    plan_key: 'pro_weekly',
                    interval: 'weekly',
                    amount_kobo: 150000,
                    paystack_plan_code: 'PLN_stale_weekly',
                    is_active: true,
                },
            });
            strict_1.default.equal(monthly?.paystack_plan_code, 'PLN_live_monthly');
            strict_1.default.equal(weekly?.paystack_plan_code, 'PLN_live_weekly');
            strict_1.default.equal(monthly?.source, 'database');
            strict_1.default.equal(weekly?.source, 'database');
        });
    });
    await run('plan keys can be recovered from billed amounts when metadata is missing', () => {
        strict_1.default.equal((0, billing_plan_catalog_js_1.resolveBillingPlanKeyByAmount)(450000), 'pro_monthly');
        strict_1.default.equal((0, billing_plan_catalog_js_1.resolveBillingPlanKeyByAmount)(150000), 'pro_weekly');
        strict_1.default.equal((0, billing_plan_catalog_js_1.resolveBillingPlanKeyByAmount)(9999), null);
    });
    await run('signed billing action tokens bind the request to the authenticated user and checksum', () => {
        const response = createMockResponse();
        const snapshot = (0, billing_session_js_1.buildBillingPlanSnapshot)({
            userId: 'user-1',
            status: {
                tier: 'pro',
                entitlementSource: 'paid',
                tier_expires_at: '2026-04-20T00:00:00.000Z',
                currentPlan: {
                    managedPlan: 'pro',
                    activePlanKey: 'pro_monthly',
                    hasPaidEntitlement: true,
                },
            },
        });
        const { requestToken } = (0, billing_session_js_1.attachBillingSessionArtifacts)(response, snapshot);
        const fakeRequest = {
            headers: {
                get(name) {
                    if (name === billing_session_js_1.BILLING_ACTION_TOKEN_HEADER)
                        return requestToken;
                    if (name === billing_session_js_1.BILLING_PLAN_CHECKSUM_HEADER)
                        return snapshot.checksum;
                    return null;
                },
            },
        };
        strict_1.default.deepEqual((0, billing_session_js_1.readBillingActionSignature)({ req: fakeRequest, userId: 'user-1' }), {
            valid: true,
            checksum: snapshot.checksum,
        });
        strict_1.default.equal((0, billing_session_js_1.readBillingActionSignature)({
            req: {
                headers: {
                    get(name) {
                        if (name === billing_session_js_1.BILLING_ACTION_TOKEN_HEADER)
                            return requestToken;
                        if (name === billing_session_js_1.BILLING_PLAN_CHECKSUM_HEADER)
                            return 'tampered';
                        return null;
                    },
                },
            },
            userId: 'user-1',
        }).valid, false);
    });
    await run('partial billing status snapshots stay unknown instead of implying free', () => {
        const snapshot = (0, billing_session_js_1.buildBillingPlanSnapshot)({
            userId: 'user-unknown',
            status: {
                currentPlan: {},
            },
        });
        strict_1.default.equal(snapshot.managedPlan, 'unknown');
        strict_1.default.equal(snapshot.entitlementSource, 'unknown');
        strict_1.default.equal(snapshot.activePlanKey, null);
    });
    await run('renewal failures are terminal immediately with no grace retry window', () => {
        const first = (0, billing_renewal_js_1.buildRenewalRetryState)({
            existingAttemptCount: 0,
            now: new Date('2026-03-20T10:00:00.000Z'),
            failureKind: (0, billing_renewal_js_1.classifyRenewalFailure)({ gatewayResponse: 'network timeout' }),
        });
        const second = (0, billing_renewal_js_1.buildRenewalRetryState)({
            existingAttemptCount: 1,
            now: new Date('2026-03-20T10:00:00.000Z'),
            failureKind: (0, billing_renewal_js_1.classifyRenewalFailure)({ gatewayResponse: 'insufficient funds' }),
        });
        strict_1.default.equal(billing_renewal_js_1.BILLING_RENEWAL_MAX_ATTEMPTS, 1);
        strict_1.default.equal(first.status, 'failed');
        strict_1.default.equal(first.finalFailure, true);
        strict_1.default.equal(first.nextRetryAt, null);
        strict_1.default.equal(second.status, 'failed');
        strict_1.default.equal(second.finalFailure, true);
        strict_1.default.equal(second.nextRetryAt, null);
    });
    await run('renewal success metadata clears retry state and preserves gateway response evidence', () => {
        const metadata = (0, billing_renewal_js_1.buildRenewalSuccessMetadata)({
            reference: 'DCAU-PRO-1',
            paidAt: '2026-03-20T10:00:00.000Z',
            gateway: 'paystack',
            gatewayResponse: { status: 'success' },
        });
        strict_1.default.equal(metadata.renewal_attempt_count, 0);
        strict_1.default.equal(metadata.renewal_final_failure, false);
        strict_1.default.equal(metadata.renewal_next_retry_at, null);
        strict_1.default.equal(metadata.renewal_last_reference, 'DCAU-PRO-1');
    });
    await run('payment method capabilities stay aligned with gateway support', () => {
        strict_1.default.deepEqual((0, payment_gateway_js_1.getSupportedPaymentMethodsForGateway)('paystack'), ['subscription', 'transfer']);
        strict_1.default.deepEqual((0, payment_gateway_js_1.getSupportedPaymentMethodsForGateway)('flutterwave'), ['transfer']);
        strict_1.default.equal((0, payment_gateway_js_1.getDefaultPaymentMethodForGateway)('paystack'), 'subscription');
        strict_1.default.equal((0, payment_gateway_js_1.getDefaultPaymentMethodForGateway)('flutterwave'), 'transfer');
        strict_1.default.equal((0, payment_gateway_js_1.isPaymentMethodSupportedForGateway)('paystack', 'subscription'), true);
        strict_1.default.equal((0, payment_gateway_js_1.isPaymentMethodSupportedForGateway)('paystack', 'transfer'), true);
        strict_1.default.equal((0, payment_gateway_js_1.isPaymentMethodSupportedForGateway)('flutterwave', 'subscription'), false);
        strict_1.default.equal((0, payment_gateway_js_1.isPaymentMethodSupportedForGateway)('flutterwave', 'transfer'), true);
        strict_1.default.equal((0, payment_gateway_js_1.coercePaymentMethodForGateway)('flutterwave', 'subscription'), 'transfer');
        strict_1.default.equal((0, payment_gateway_js_1.coercePaymentMethodForGateway)('paystack', 'subscription'), 'subscription');
    });
    await run('billing request idempotency keys are normalized and request bodies hash deterministically', () => {
        strict_1.default.equal((0, billing_request_guard_js_1.normalizeBillingIdempotencyKey)(' billing-checkout:1234 '), 'billing-checkout:1234');
        strict_1.default.equal((0, billing_request_guard_js_1.normalizeBillingIdempotencyKey)('bad key with spaces'), '');
        strict_1.default.equal((0, billing_request_guard_js_1.hashBillingRequestPayload)({ plan_key: 'pro_monthly', payment_method: 'subscription' }), (0, billing_request_guard_js_1.hashBillingRequestPayload)({ payment_method: 'subscription', plan_key: 'pro_monthly' }));
    });
    await run('rate limiting trips after the configured number of hits', () => {
        const first = (0, billing_request_guard_js_1.consumeBillingRateLimit)({
            scope: 'checkout',
            key: 'user-1',
            maxHits: 2,
            windowMs: 60000,
        });
        const second = (0, billing_request_guard_js_1.consumeBillingRateLimit)({
            scope: 'checkout',
            key: 'user-1',
            maxHits: 2,
            windowMs: 60000,
        });
        const third = (0, billing_request_guard_js_1.consumeBillingRateLimit)({
            scope: 'checkout',
            key: 'user-1',
            maxHits: 2,
            windowMs: 60000,
        });
        strict_1.default.equal(first.limited, false);
        strict_1.default.equal(second.limited, false);
        strict_1.default.equal(third.limited, true);
    });
    await run('stale concurrent billing refresh responses are ignored in favor of the latest authoritative snapshot', () => {
        strict_1.default.equal((0, plan_refresh_state_js_1.shouldApplyBillingStatusResponse)({
            requestId: 1,
            activeRequestId: 2,
            currentIssuedAt: '2026-03-20T10:05:00.000Z',
            nextIssuedAt: '2026-03-20T10:00:00.000Z',
        }), false);
        strict_1.default.equal((0, plan_refresh_state_js_1.shouldApplyBillingStatusResponse)({
            requestId: 2,
            activeRequestId: 2,
            currentIssuedAt: '2026-03-20T10:00:00.000Z',
            nextIssuedAt: '2026-03-20T10:05:00.000Z',
        }), true);
    });
    await run('displayed plan code prefers the canonical limits snapshot over billing-side hints', () => {
        strict_1.default.equal((0, plan_refresh_state_js_1.resolveDisplayedPlanCode)({
            snapshot: { managedPlan: 'pro', checksum: 'abc', issuedAt: '2026-03-20T10:05:00.000Z' },
            currentPlanManagedPlan: 'pro',
            tier: 'pro',
            limitsUsagePlan: 'free',
        }), 'free');
        strict_1.default.equal((0, plan_refresh_state_js_1.resolveDisplayedPlanCode)({
            snapshot: { managedPlan: 'pro', checksum: 'abc', issuedAt: '2026-03-20T10:05:00.000Z' },
            currentPlanManagedPlan: 'free',
            tier: 'free',
            limitsUsagePlan: null,
        }), 'pro');
        strict_1.default.equal((0, plan_refresh_state_js_1.resolveDisplayedPlanCode)({
            snapshot: null,
            currentPlanManagedPlan: null,
            tier: null,
            limitsUsagePlan: 'monthly',
        }), 'monthly');
        strict_1.default.equal((0, plan_refresh_state_js_1.resolveDisplayedPlanCode)({
            snapshot: null,
            currentPlanManagedPlan: null,
            tier: null,
            limitsUsagePlan: null,
        }), null);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
