import assert from 'node:assert/strict';
import {
  BILLING_PLAN_CODES,
  DEFAULT_BILLING_PLAN_CATALOG,
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

  await run('renewal retries back off exponentially and downgrade on final failure', () => {
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
    const final = buildRenewalRetryState({
      existingAttemptCount: BILLING_RENEWAL_MAX_ATTEMPTS - 1,
      now: new Date('2026-03-20T10:00:00.000Z'),
      failureKind: classifyRenewalFailure({ gatewayResponse: 'do not honor' }),
    });

    assert.equal(first.status, 'retrying');
    assert.equal(first.finalFailure, false);
    assert.ok(first.nextRetryAt);
    assert.equal(second.status, 'retrying');
    assert.ok(new Date(String(second.nextRetryAt)).getTime() > new Date(String(first.nextRetryAt)).getTime());
    assert.equal(final.status, 'failed');
    assert.equal(final.finalFailure, true);
    assert.equal(final.nextRetryAt, null);
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
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
