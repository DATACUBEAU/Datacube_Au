import assert from 'node:assert/strict';
import {
  buildSubscriptionCardState,
  canStartCheckoutForPlan,
  deriveNormalizedSubscriptionState,
  resolvePlanStatusLabelFromState,
} from '../src/lib/billing/subscription-state.js';
import {
  normalizeBillingManagedPlan,
  normalizeCanonicalBillingPlanKey,
} from '../src/lib/billing/plans.js';
import {
  BillingConfigurationError,
  assertBillingGatewayCapability,
  serializeBillingApiError,
} from '../src/lib/server/billing-config.js';

let failed = 0;

type SyncOrAsyncTest = () => void | Promise<void>;

async function run(name: string, fn: SyncOrAsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
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
} as const;

const CHECKOUT_DISABLED = {
  enabled: false,
  gateway: 'paystack',
  code: 'paystack_env_missing',
  message: 'Paystack checkout is not configured on the server.',
} as const;

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
  await run('plan alias normalization maps legacy identifiers to canonical billing keys', () => {
    assert.equal(normalizeCanonicalBillingPlanKey('paid'), 'pro');
    assert.equal(normalizeCanonicalBillingPlanKey('monthly_pro'), 'pro_monthly');
    assert.equal(normalizeCanonicalBillingPlanKey('weekly-pro'), 'pro_weekly');
    assert.equal(normalizeBillingManagedPlan('premium'), 'premium');
  });

  await run('active Pro Monthly card renders as current plan', () => {
    const state = deriveNormalizedSubscriptionState({
      effectivePlan: 'pro',
      entitlementSource: 'paid',
      subscriptionPlanKey: 'monthly_pro',
      subscriptionStatus: 'active',
    });

    const monthlyCard = buildSubscriptionCardState({
      planKey: 'pro_monthly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    });
    const weeklyCard = buildSubscriptionCardState({
      planKey: 'pro_weekly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    });

    assert.equal(state.activePlanKey, 'pro_monthly');
    assert.equal(resolvePlanStatusLabelFromState(state), 'Pro');
    assert.equal(monthlyCard.isCurrent, true);
    assert.equal(monthlyCard.ctaLabel, 'MANAGE PLAN');
    assert.equal(monthlyCard.disabled, true);
    assert.equal(weeklyCard.isCurrent, false);
    assert.equal(weeklyCard.action, 'select');
  });

  await run('active Pro Weekly card renders as current plan', () => {
    const state = deriveNormalizedSubscriptionState({
      effectivePlan: 'pro',
      entitlementSource: 'paid',
      legacyTier: 'weekly',
    });

    const weeklyCard = buildSubscriptionCardState({
      planKey: 'pro_weekly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    });
    const monthlyCard = buildSubscriptionCardState({
      planKey: 'pro_monthly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    });

    assert.equal(state.activePlanKey, 'pro_weekly');
    assert.equal(state.currentPlanLabel, 'Pro Weekly');
    assert.equal(weeklyCard.isCurrent, true);
    assert.equal(weeklyCard.ctaLabel, 'CURRENT PLAN');
    assert.equal(monthlyCard.isCurrent, false);
    assert.equal(monthlyCard.action, 'select');
  });

  await run('missing subscription authority stays pending instead of silently becoming free', () => {
    const state = deriveNormalizedSubscriptionState({});
    const freeCard = buildSubscriptionCardState({
      planKey: 'free',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    });

    assert.equal(state.managedPlan, 'free');
    assert.equal(state.isAuthoritative, false);
    assert.equal(state.resolutionSource, 'unknown');
    assert.equal(state.activePlanKey, null);
    assert.equal(state.currentPlanLabel, 'Plan pending');
    assert.equal(freeCard.isCurrent, false);
    assert.equal(freeCard.ctaLabel, 'PLAN LOADING');
    assert.equal(freeCard.disabled, true);
  });

  await run('clicking the active plan never reaches checkout init', () => {
    const state = deriveNormalizedSubscriptionState({
      effectivePlan: 'pro',
      entitlementSource: 'paid',
      subscriptionPlanKey: 'pro_monthly',
      subscriptionStatus: 'active',
    });

    let checkoutInitCalls = 0;
    if (canStartCheckoutForPlan({
      planKey: 'pro_monthly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    })) {
      checkoutInitCalls += 1;
    }

    assert.equal(checkoutInitCalls, 0);
  });

  await run('missing PAYSTACK_SECRET_KEY returns a safe typed billing error response', () => {
    withEnv({
      PAYSTACK_SECRET_KEY: undefined,
      PAYSTACK_SECRET: undefined,
    }, () => {
      let error: unknown = null;
      try {
        assertBillingGatewayCapability({
          gateway: 'paystack',
          action: 'checkout_initialize',
        });
      } catch (caught) {
        error = caught;
      }

      assert.ok(error instanceof BillingConfigurationError);
      const serialized = serializeBillingApiError(error, {
        status: 400,
        code: 'checkout_failed',
        message: 'Checkout failed.',
        requestId: 'req-billing-test',
      });

      assert.equal(serialized.status, 503);
      assert.equal(serialized.body.error, 'billing_gateway_not_configured');
      assert.equal(serialized.body.requestId, 'req-billing-test');
      assert.deepEqual((serialized.body.details as any)?.missingEnv, ['PAYSTACK_SECRET_KEY']);
    });
  });

  await run('PAYSTACK_SECRET_KEY enables paystack billing without requiring a client key', () => {
    withEnv({
      PAYSTACK_SECRET_KEY: 'sk_live_server_only',
      PAYSTACK_SECRET: undefined,
      NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: undefined,
    }, () => {
      const capability = assertBillingGatewayCapability({
        gateway: 'paystack',
        action: 'checkout_initialize',
      });

      assert.equal(capability.enabled, true);
    });
  });

  await run('client public key alone does not satisfy server paystack billing requirements', () => {
    withEnv({
      PAYSTACK_SECRET_KEY: undefined,
      PAYSTACK_SECRET: undefined,
      NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: 'pk_live_public_only',
    }, () => {
      let error: unknown = null;
      try {
        assertBillingGatewayCapability({
          gateway: 'paystack',
          action: 'checkout_initialize',
        });
      } catch (caught) {
        error = caught;
      }

      assert.ok(error instanceof BillingConfigurationError);
    });
  });

  await run('frontend keeps the active plan non-selectable when checkout initialization fails', () => {
    const state = deriveNormalizedSubscriptionState({
      effectivePlan: 'pro',
      entitlementSource: 'paid',
      subscriptionPlanKey: 'pro_monthly',
      subscriptionStatus: 'active',
    });

    const monthlyCard = buildSubscriptionCardState({
      planKey: 'pro_monthly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_DISABLED,
    });
    const weeklyCard = buildSubscriptionCardState({
      planKey: 'pro_weekly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_DISABLED,
    });

    assert.equal(monthlyCard.action, 'manage');
    assert.equal(monthlyCard.ctaLabel, 'MANAGE PLAN');
    assert.equal(monthlyCard.disabled, true);
    assert.equal(weeklyCard.action, 'unavailable');
    assert.equal(weeklyCard.ctaLabel, 'UNAVAILABLE');
  });

  await run('sidebar label and pricing cards stay aligned from the normalized subscription state', () => {
    const state = deriveNormalizedSubscriptionState({
      effectivePlan: 'pro',
      entitlementSource: 'paid',
      subscriptionPlanKey: 'pro_weekly',
      subscriptionStatus: 'active',
    });

    const weeklyCard = buildSubscriptionCardState({
      planKey: 'pro_weekly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    });
    const monthlyCard = buildSubscriptionCardState({
      planKey: 'pro_monthly',
      state,
      canAccessBilling: true,
      checkout: CHECKOUT_ENABLED,
    });

    assert.equal(resolvePlanStatusLabelFromState(state), 'Pro');
    assert.equal(weeklyCard.isCurrent, true);
    assert.equal(monthlyCard.isCurrent, false);
    assert.equal(state.currentPlanLabel, 'Pro Weekly');
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
