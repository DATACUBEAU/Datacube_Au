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
async function main() {
    await run('rotated Paystack plan codes are the canonical defaults', () => {
        strict_1.default.equal(billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_weekly, 'PLN_h3teb0z285iuyet');
        strict_1.default.equal(billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_monthly, 'PLN_bo7k3ulauwdhzjl');
        strict_1.default.equal(billing_plan_catalog_js_1.DEFAULT_BILLING_PLAN_CATALOG.find((plan) => plan.planKey === 'pro_weekly')?.fallbackPaystackPlanCode, billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_weekly);
        strict_1.default.equal(billing_plan_catalog_js_1.DEFAULT_BILLING_PLAN_CATALOG.find((plan) => plan.planKey === 'pro_monthly')?.fallbackPaystackPlanCode, billing_plan_catalog_js_1.BILLING_PLAN_CODES.pro_monthly);
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
    await run('renewal retries back off exponentially and downgrade on final failure', () => {
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
        const final = (0, billing_renewal_js_1.buildRenewalRetryState)({
            existingAttemptCount: billing_renewal_js_1.BILLING_RENEWAL_MAX_ATTEMPTS - 1,
            now: new Date('2026-03-20T10:00:00.000Z'),
            failureKind: (0, billing_renewal_js_1.classifyRenewalFailure)({ gatewayResponse: 'do not honor' }),
        });
        strict_1.default.equal(first.status, 'retrying');
        strict_1.default.equal(first.finalFailure, false);
        strict_1.default.ok(first.nextRetryAt);
        strict_1.default.equal(second.status, 'retrying');
        strict_1.default.ok(new Date(String(second.nextRetryAt)).getTime() > new Date(String(first.nextRetryAt)).getTime());
        strict_1.default.equal(final.status, 'failed');
        strict_1.default.equal(final.finalFailure, true);
        strict_1.default.equal(final.nextRetryAt, null);
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
