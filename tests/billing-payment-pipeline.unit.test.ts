import assert from 'node:assert/strict';
import {
  BILLING_PLAN_CODES,
  DEFAULT_BILLING_PLAN_CATALOG,
  materializeBillingPlanRow,
  resolveBillingPlanKeyByAmount,
} from '../src/lib/server/billing-plan-catalog.js';
import {
  BILLING_RENEWAL_MAX_ATTEMPTS,
  buildRenewalRetryState,
  buildRenewalSuccessMetadata,
  classifyRenewalFailure,
} from '../src/lib/server/billing-renewal.js';
import {
  BILLING_ACTION_TOKEN_HEADER,
  BILLING_PLAN_CHECKSUM_HEADER,
  attachBillingSessionArtifacts,
  buildBillingPlanSnapshot,
  readBillingActionSignature,
} from '../src/lib/server/billing-session.js';
import {
  consumeBillingRateLimit,
  hashBillingRequestPayload,
  normalizeBillingIdempotencyKey,
} from '../src/lib/server/billing-request-guard.js';
import {
  resolveDisplayedPlanCode,
  shouldApplyBillingStatusResponse,
} from '../src/lib/billing/plan-refresh-state.js';
import {
  coercePaymentMethodForGateway,
  getDefaultPaymentMethodForGateway,
  getSupportedPaymentMethodsForGateway,
  isPaymentMethodSupportedForGateway,
} from '../src/lib/payments/payment-gateway.js';

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

function createMockResponse() {
  const cookies = new Map<string, { value: string; options: Record<string, unknown> }>();
  const headers = new Map<string, string>();
  return {
    cookies: {
      set(name: string, value: string, options: Record<string, unknown>) {
        cookies.set(name, { value, options });
      },
      get(name: string) {
        return cookies.get(name);
      },
    },
    headers: {
      set(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main() {
  await run('rotated Paystack plan codes are the canonical defaults', () => {
    assert.equal(BILLING_PLAN_CODES.pro_weekly, 'PLN_h3teb0z285iuyet');
    assert.equal(BILLING_PLAN_CODES.pro_monthly, 'PLN_bo7k3ulauwdhzjl');
    assert.equal(
      DEFAULT_BILLING_PLAN_CATALOG.find((plan) => plan.planKey === 'pro_weekly')?.fallbackPaystackPlanCode,
      BILLING_PLAN_CODES.pro_weekly,
    );
    assert.equal(
      DEFAULT_BILLING_PLAN_CATALOG.find((plan) => plan.planKey === 'pro_monthly')?.fallbackPaystackPlanCode,
      BILLING_PLAN_CODES.pro_monthly,
    );
  });

  await run('missing billing plan rows fall back to the default catalog without losing plan pricing', () => {
    const monthly = materializeBillingPlanRow({ planKeyRaw: 'monthly_pro' });
    const weekly = materializeBillingPlanRow({ planKeyRaw: 'weekly' });

    assert.deepEqual(monthly, {
      plan_key: 'pro_monthly',
      interval: 'monthly',
      amount_kobo: 450000,
      paystack_plan_code: BILLING_PLAN_CODES.pro_monthly,
      is_active: true,
      source: 'default_catalog',
    });
    assert.deepEqual(weekly, {
      plan_key: 'pro_weekly',
      interval: 'weekly',
      amount_kobo: 150000,
      paystack_plan_code: BILLING_PLAN_CODES.pro_weekly,
      is_active: true,
      source: 'default_catalog',
    });
  });

  await run('configured Paystack plan codes override stale database plan rows', () => {
    withEnv({
      PAYSTACK_PLAN_MONTHLY_CODE: 'PLN_live_monthly',
      PAYSTACK_PLAN_WEEKLY_CODE: 'PLN_live_weekly',
    }, () => {
      const monthly = materializeBillingPlanRow({
        planKeyRaw: 'pro_monthly',
        row: {
          plan_key: 'pro_monthly',
          interval: 'monthly',
          amount_kobo: 450000,
          paystack_plan_code: 'PLN_stale_monthly',
          is_active: true,
        },
      });
      const weekly = materializeBillingPlanRow({
        planKeyRaw: 'pro_weekly',
        row: {
          plan_key: 'pro_weekly',
          interval: 'weekly',
          amount_kobo: 150000,
          paystack_plan_code: 'PLN_stale_weekly',
          is_active: true,
        },
      });

      assert.equal(monthly?.paystack_plan_code, 'PLN_live_monthly');
      assert.equal(weekly?.paystack_plan_code, 'PLN_live_weekly');
      assert.equal(monthly?.source, 'database');
      assert.equal(weekly?.source, 'database');
    });
  });

  await run('plan keys can be recovered from billed amounts when metadata is missing', () => {
    assert.equal(resolveBillingPlanKeyByAmount(450000), 'pro_monthly');
    assert.equal(resolveBillingPlanKeyByAmount(150000), 'pro_weekly');
    assert.equal(resolveBillingPlanKeyByAmount(9999), null);
  });

  await run('signed billing action tokens bind the request to the authenticated user and checksum', () => {
    const response = createMockResponse();
    const snapshot = buildBillingPlanSnapshot({
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

    const { requestToken } = attachBillingSessionArtifacts(response as any, snapshot);
    const fakeRequest = {
      headers: {
        get(name: string) {
          if (name === BILLING_ACTION_TOKEN_HEADER) return requestToken;
          if (name === BILLING_PLAN_CHECKSUM_HEADER) return snapshot.checksum;
          return null;
        },
      },
    };

    assert.deepEqual(readBillingActionSignature({ req: fakeRequest as any, userId: 'user-1' }), {
      valid: true,
      checksum: snapshot.checksum,
    });
    assert.equal(
      readBillingActionSignature({
        req: {
          headers: {
            get(name: string) {
              if (name === BILLING_ACTION_TOKEN_HEADER) return requestToken;
              if (name === BILLING_PLAN_CHECKSUM_HEADER) return 'tampered';
              return null;
            },
          },
        } as any,
        userId: 'user-1',
      }).valid,
      false,
    );
  });

  await run('partial billing status snapshots stay unknown instead of implying free', () => {
    const snapshot = buildBillingPlanSnapshot({
      userId: 'user-unknown',
      status: {
        currentPlan: {},
      },
    });

    assert.equal(snapshot.managedPlan, 'unknown');
    assert.equal(snapshot.entitlementSource, 'unknown');
    assert.equal(snapshot.activePlanKey, null);
  });

  await run('renewal failures are terminal immediately with no grace retry window', () => {
    const first = buildRenewalRetryState({
      existingAttemptCount: 0,
      now: new Date('2026-03-20T10:00:00.000Z'),
      failureKind: classifyRenewalFailure({ gatewayResponse: 'network timeout' }),
    });
    const second = buildRenewalRetryState({
      existingAttemptCount: 1,
      now: new Date('2026-03-20T10:00:00.000Z'),
      failureKind: classifyRenewalFailure({ gatewayResponse: 'insufficient funds' }),
    });

    assert.equal(BILLING_RENEWAL_MAX_ATTEMPTS, 1);
    assert.equal(first.status, 'failed');
    assert.equal(first.finalFailure, true);
    assert.equal(first.nextRetryAt, null);
    assert.equal(second.status, 'failed');
    assert.equal(second.finalFailure, true);
    assert.equal(second.nextRetryAt, null);
  });

  await run('renewal success metadata clears retry state and preserves gateway response evidence', () => {
    const metadata = buildRenewalSuccessMetadata({
      reference: 'DCAU-PRO-1',
      paidAt: '2026-03-20T10:00:00.000Z',
      gateway: 'paystack',
      gatewayResponse: { status: 'success' },
    });

    assert.equal(metadata.renewal_attempt_count, 0);
    assert.equal(metadata.renewal_final_failure, false);
    assert.equal(metadata.renewal_next_retry_at, null);
    assert.equal(metadata.renewal_last_reference, 'DCAU-PRO-1');
  });

  await run('payment method capabilities stay aligned with gateway support', () => {
    assert.deepEqual(getSupportedPaymentMethodsForGateway('paystack'), ['subscription', 'transfer']);
    assert.deepEqual(getSupportedPaymentMethodsForGateway('flutterwave'), ['transfer']);
    assert.equal(getDefaultPaymentMethodForGateway('paystack'), 'subscription');
    assert.equal(getDefaultPaymentMethodForGateway('flutterwave'), 'transfer');
    assert.equal(isPaymentMethodSupportedForGateway('paystack', 'subscription'), true);
    assert.equal(isPaymentMethodSupportedForGateway('paystack', 'transfer'), true);
    assert.equal(isPaymentMethodSupportedForGateway('flutterwave', 'subscription'), false);
    assert.equal(isPaymentMethodSupportedForGateway('flutterwave', 'transfer'), true);
    assert.equal(coercePaymentMethodForGateway('flutterwave', 'subscription'), 'transfer');
    assert.equal(coercePaymentMethodForGateway('paystack', 'subscription'), 'subscription');
  });

  await run('billing request idempotency keys are normalized and request bodies hash deterministically', () => {
    assert.equal(normalizeBillingIdempotencyKey(' billing-checkout:1234 '), 'billing-checkout:1234');
    assert.equal(normalizeBillingIdempotencyKey('bad key with spaces'), '');
    assert.equal(
      hashBillingRequestPayload({ plan_key: 'pro_monthly', payment_method: 'subscription' }),
      hashBillingRequestPayload({ payment_method: 'subscription', plan_key: 'pro_monthly' }),
    );
  });

  await run('rate limiting trips after the configured number of hits', () => {
    const first = consumeBillingRateLimit({
      scope: 'checkout',
      key: 'user-1',
      maxHits: 2,
      windowMs: 60_000,
    });
    const second = consumeBillingRateLimit({
      scope: 'checkout',
      key: 'user-1',
      maxHits: 2,
      windowMs: 60_000,
    });
    const third = consumeBillingRateLimit({
      scope: 'checkout',
      key: 'user-1',
      maxHits: 2,
      windowMs: 60_000,
    });

    assert.equal(first.limited, false);
    assert.equal(second.limited, false);
    assert.equal(third.limited, true);
  });

  await run('stale concurrent billing refresh responses are ignored in favor of the latest authoritative snapshot', () => {
    assert.equal(
      shouldApplyBillingStatusResponse({
        requestId: 1,
        activeRequestId: 2,
        currentIssuedAt: '2026-03-20T10:05:00.000Z',
        nextIssuedAt: '2026-03-20T10:00:00.000Z',
      }),
      false,
    );
    assert.equal(
      shouldApplyBillingStatusResponse({
        requestId: 2,
        activeRequestId: 2,
        currentIssuedAt: '2026-03-20T10:00:00.000Z',
        nextIssuedAt: '2026-03-20T10:05:00.000Z',
      }),
      true,
    );
  });

  await run('displayed plan code prefers the canonical limits snapshot over billing-side hints', () => {
    assert.equal(
      resolveDisplayedPlanCode({
        snapshot: { managedPlan: 'pro', checksum: 'abc', issuedAt: '2026-03-20T10:05:00.000Z' },
        currentPlanManagedPlan: 'pro',
        tier: 'pro',
        limitsUsagePlan: 'free',
      }),
      'free',
    );
    assert.equal(
      resolveDisplayedPlanCode({
        snapshot: { managedPlan: 'pro', checksum: 'abc', issuedAt: '2026-03-20T10:05:00.000Z' },
        currentPlanManagedPlan: 'free',
        tier: 'free',
        limitsUsagePlan: null,
      }),
      'pro',
    );
    assert.equal(
      resolveDisplayedPlanCode({
        snapshot: null,
        currentPlanManagedPlan: null,
        tier: null,
        limitsUsagePlan: 'monthly',
      }),
      'monthly',
    );
    assert.equal(
      resolveDisplayedPlanCode({
        snapshot: null,
        currentPlanManagedPlan: null,
        tier: null,
        limitsUsagePlan: null,
      }),
      null,
    );
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
