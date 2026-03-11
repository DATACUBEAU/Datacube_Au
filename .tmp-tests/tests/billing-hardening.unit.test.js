"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const payment_return_js_1 = require("../src/lib/billing/payment-return.js");
const subscription_cancel_js_1 = require("../src/lib/billing/subscription-cancel.js");
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
async function main() {
    await run('paystack callback params resolve to a verifiable reference', () => {
        const result = (0, payment_return_js_1.extractBillingReturnState)(new URLSearchParams({
            reference: 'DCAU-PRO-123',
            trxref: 'DCAU-PRO-123',
            success: 'true',
        }));
        strict_1.default.equal(result.reference, 'DCAU-PRO-123');
        strict_1.default.equal(result.verificationTarget, 'DCAU-PRO-123');
        strict_1.default.equal(result.gatewayHint, 'paystack');
        strict_1.default.equal(result.isSuccess, true);
    });
    await run('flutterwave callback params resolve tx_ref without losing the transaction id', () => {
        const result = (0, payment_return_js_1.extractBillingReturnState)(new URLSearchParams({
            tx_ref: 'DCAU-PRO-456',
            transaction_id: '991122',
            status: 'successful',
        }));
        strict_1.default.equal(result.reference, 'DCAU-PRO-456');
        strict_1.default.equal(result.verificationTarget, 'DCAU-PRO-456');
        strict_1.default.equal(result.transactionId, '991122');
        strict_1.default.equal(result.gatewayHint, 'flutterwave');
        strict_1.default.equal(result.isSuccess, true);
    });
    await run('explicit verification targets from request bodies are preserved', () => {
        const result = (0, payment_return_js_1.extractBillingReturnState)({
            verification_target: '991122',
            transaction_id: '991122',
            gateway: 'flutterwave',
        });
        strict_1.default.equal(result.reference, null);
        strict_1.default.equal(result.verificationTarget, '991122');
        strict_1.default.equal(result.transactionId, '991122');
        strict_1.default.equal(result.gatewayHint, 'flutterwave');
    });
    await run('cancelled provider returns are treated as canceled callback states', () => {
        const result = (0, payment_return_js_1.extractBillingReturnState)(new URLSearchParams({
            status: 'cancelled',
        }));
        strict_1.default.equal(result.isCanceled, true);
        strict_1.default.equal(result.hasCallbackState, true);
    });
    await run('active paystack subscriptions with credentials use remote cancellation', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionCancellation)({
            status: 'active',
            gateway: 'paystack',
            paystackSubscriptionCode: 'SUB_123',
            paystackEmailToken: 'TOKEN_123',
        });
        strict_1.default.equal(result.mode, 'remote_cancel');
        strict_1.default.equal(result.reason, 'remote_cancel_supported');
    });
    await run('active subscriptions without paystack credentials fall back to local scheduling', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionCancellation)({
            status: 'active',
            gateway: 'paystack',
            paystackSubscriptionCode: 'SUB_123',
            paystackEmailToken: '',
        });
        strict_1.default.equal(result.mode, 'local_schedule');
        strict_1.default.equal(result.reason, 'missing_gateway_credentials');
    });
    await run('non-paystack subscriptions schedule cancellation locally instead of erroring', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionCancellation)({
            status: 'active',
            gateway: 'flutterwave',
        });
        strict_1.default.equal(result.mode, 'local_schedule');
        strict_1.default.equal(result.reason, 'unsupported_gateway');
    });
    await run('already non-renewing subscriptions are treated as idempotent no-ops', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionCancellation)({
            status: 'non_renewing',
            cancelAtPeriodEnd: true,
            gateway: 'paystack',
        });
        strict_1.default.equal(result.mode, 'noop');
        strict_1.default.equal(result.reason, 'already_non_renewing');
    });
    await run('missing subscription state stays a no-op instead of a bad request', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionCancellation)({});
        strict_1.default.equal(result.mode, 'noop');
        strict_1.default.equal(result.reason, 'no_subscription');
    });
    await run('non-renewing paystack subscriptions with credentials use remote resumption', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionResumption)({
            status: 'non_renewing',
            cancelAtPeriodEnd: true,
            gateway: 'paystack',
            paystackSubscriptionCode: 'SUB_123',
            paystackEmailToken: 'TOKEN_123',
        });
        strict_1.default.equal(result.mode, 'remote_resume');
        strict_1.default.equal(result.reason, 'remote_resume_supported');
    });
    await run('already-renewing subscriptions are idempotent no-ops for resume', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionResumption)({
            status: 'active',
            cancelAtPeriodEnd: false,
            gateway: 'paystack',
        });
        strict_1.default.equal(result.mode, 'noop');
        strict_1.default.equal(result.reason, 'already_renewing');
    });
    await run('non-paystack resume requests safely fall back to local resumption', () => {
        const result = (0, subscription_cancel_js_1.resolveSubscriptionResumption)({
            status: 'non_renewing',
            cancelAtPeriodEnd: true,
            gateway: 'flutterwave',
        });
        strict_1.default.equal(result.mode, 'local_resume');
        strict_1.default.equal(result.reason, 'unsupported_gateway');
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
