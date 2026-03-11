import assert from 'node:assert/strict';
import { extractBillingReturnState } from '../src/lib/billing/payment-return.js';
import {
  resolveSubscriptionCancellation,
  resolveSubscriptionResumption,
} from '../src/lib/billing/subscription-cancel.js';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

async function run(name: string, fn: AsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

async function main() {
  await run('paystack callback params resolve to a verifiable reference', () => {
    const result = extractBillingReturnState(
      new URLSearchParams({
        reference: 'DCAU-PRO-123',
        trxref: 'DCAU-PRO-123',
        success: 'true',
      }),
    );

    assert.equal(result.reference, 'DCAU-PRO-123');
    assert.equal(result.verificationTarget, 'DCAU-PRO-123');
    assert.equal(result.gatewayHint, 'paystack');
    assert.equal(result.isSuccess, true);
  });

  await run('flutterwave callback params resolve tx_ref without losing the transaction id', () => {
    const result = extractBillingReturnState(
      new URLSearchParams({
        tx_ref: 'DCAU-PRO-456',
        transaction_id: '991122',
        status: 'successful',
      }),
    );

    assert.equal(result.reference, 'DCAU-PRO-456');
    assert.equal(result.verificationTarget, 'DCAU-PRO-456');
    assert.equal(result.transactionId, '991122');
    assert.equal(result.gatewayHint, 'flutterwave');
    assert.equal(result.isSuccess, true);
  });

  await run('explicit verification targets from request bodies are preserved', () => {
    const result = extractBillingReturnState({
      verification_target: '991122',
      transaction_id: '991122',
      gateway: 'flutterwave',
    });

    assert.equal(result.reference, null);
    assert.equal(result.verificationTarget, '991122');
    assert.equal(result.transactionId, '991122');
    assert.equal(result.gatewayHint, 'flutterwave');
  });

  await run('cancelled provider returns are treated as canceled callback states', () => {
    const result = extractBillingReturnState(
      new URLSearchParams({
        status: 'cancelled',
      }),
    );

    assert.equal(result.isCanceled, true);
    assert.equal(result.hasCallbackState, true);
  });

  await run('active paystack subscriptions with credentials use remote cancellation', () => {
    const result = resolveSubscriptionCancellation({
      status: 'active',
      gateway: 'paystack',
      paystackSubscriptionCode: 'SUB_123',
      paystackEmailToken: 'TOKEN_123',
    });

    assert.equal(result.mode, 'remote_cancel');
    assert.equal(result.reason, 'remote_cancel_supported');
  });

  await run('active subscriptions without paystack credentials fall back to local scheduling', () => {
    const result = resolveSubscriptionCancellation({
      status: 'active',
      gateway: 'paystack',
      paystackSubscriptionCode: 'SUB_123',
      paystackEmailToken: '',
    });

    assert.equal(result.mode, 'local_schedule');
    assert.equal(result.reason, 'missing_gateway_credentials');
  });

  await run('non-paystack subscriptions schedule cancellation locally instead of erroring', () => {
    const result = resolveSubscriptionCancellation({
      status: 'active',
      gateway: 'flutterwave',
    });

    assert.equal(result.mode, 'local_schedule');
    assert.equal(result.reason, 'unsupported_gateway');
  });

  await run('already non-renewing subscriptions are treated as idempotent no-ops', () => {
    const result = resolveSubscriptionCancellation({
      status: 'non_renewing',
      cancelAtPeriodEnd: true,
      gateway: 'paystack',
    });

    assert.equal(result.mode, 'noop');
    assert.equal(result.reason, 'already_non_renewing');
  });

  await run('missing subscription state stays a no-op instead of a bad request', () => {
    const result = resolveSubscriptionCancellation({});

    assert.equal(result.mode, 'noop');
    assert.equal(result.reason, 'no_subscription');
  });

  await run('non-renewing paystack subscriptions with credentials use remote resumption', () => {
    const result = resolveSubscriptionResumption({
      status: 'non_renewing',
      cancelAtPeriodEnd: true,
      gateway: 'paystack',
      paystackSubscriptionCode: 'SUB_123',
      paystackEmailToken: 'TOKEN_123',
    });

    assert.equal(result.mode, 'remote_resume');
    assert.equal(result.reason, 'remote_resume_supported');
  });

  await run('already-renewing subscriptions are idempotent no-ops for resume', () => {
    const result = resolveSubscriptionResumption({
      status: 'active',
      cancelAtPeriodEnd: false,
      gateway: 'paystack',
    });

    assert.equal(result.mode, 'noop');
    assert.equal(result.reason, 'already_renewing');
  });

  await run('non-paystack resume requests safely fall back to local resumption', () => {
    const result = resolveSubscriptionResumption({
      status: 'non_renewing',
      cancelAtPeriodEnd: true,
      gateway: 'flutterwave',
    });

    assert.equal(result.mode, 'local_resume');
    assert.equal(result.reason, 'unsupported_gateway');
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
