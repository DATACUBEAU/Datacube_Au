import assert from 'node:assert/strict';
import {
  materializeBillingPlanRow,
  resolveBillingPlanKeyByAmount,
} from '../src/lib/server/billing-plan-catalog.js';
import {
  coercePaymentMethodForGateway,
  getDefaultPaymentMethodForGateway,
  isPaymentMethodSupportedForGateway,
  type PaymentGatewayId,
  type PaymentMethod,
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

function simulateCheckout(input: {
  gateway: PaymentGatewayId;
  requestedPlanKey: unknown;
  requestedPaymentMethod: PaymentMethod;
}) {
  const plan = materializeBillingPlanRow({ planKeyRaw: input.requestedPlanKey });
  if (!plan || !plan.is_active) {
    return { ok: false as const, error: 'plan_not_available' };
  }
  if (!isPaymentMethodSupportedForGateway(input.gateway, input.requestedPaymentMethod)) {
    return {
      ok: false as const,
      error: 'payment_method_not_supported',
      defaultPaymentMethod: getDefaultPaymentMethodForGateway(input.gateway),
    };
  }
  return {
    ok: true as const,
    plan,
    effectivePaymentMethod: coercePaymentMethodForGateway(input.gateway, input.requestedPaymentMethod),
  };
}

function simulateVerification(input: {
  gateway: PaymentGatewayId;
  metadataPlanKey?: unknown;
  amountKobo: number;
  requestedPaymentMethod: PaymentMethod;
}) {
  const recoveredPlanKey =
    materializeBillingPlanRow({ planKeyRaw: input.metadataPlanKey })?.plan_key ||
    resolveBillingPlanKeyByAmount(input.amountKobo);
  const plan = materializeBillingPlanRow({ planKeyRaw: recoveredPlanKey });
  if (!plan) {
    return { ok: false as const, error: 'payment_plan_unresolvable' };
  }
  const effectivePaymentMethod = coercePaymentMethodForGateway(input.gateway, input.requestedPaymentMethod);
  return {
    ok: true as const,
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
    assert.equal(checkout.ok, true);
    if (!checkout.ok) return;
    assert.equal(checkout.plan.plan_key, 'pro_monthly');
    assert.equal(checkout.effectivePaymentMethod, 'subscription');

    const verification = simulateVerification({
      gateway: 'paystack',
      metadataPlanKey: checkout.plan.plan_key,
      amountKobo: checkout.plan.amount_kobo,
      requestedPaymentMethod: checkout.effectivePaymentMethod,
    });
    assert.equal(verification.ok, true);
    if (!verification.ok) return;
    assert.equal(verification.planKey, 'pro_monthly');
    assert.equal(verification.createsSubscription, true);
  });

  await run('Paystack transfer checkout resolves a one-time weekly payment path', () => {
    const checkout = simulateCheckout({
      gateway: 'paystack',
      requestedPlanKey: 'weekly',
      requestedPaymentMethod: 'transfer',
    });
    assert.equal(checkout.ok, true);
    if (!checkout.ok) return;
    assert.equal(checkout.plan.plan_key, 'pro_weekly');
    assert.equal(checkout.effectivePaymentMethod, 'transfer');

    const verification = simulateVerification({
      gateway: 'paystack',
      metadataPlanKey: checkout.plan.plan_key,
      amountKobo: checkout.plan.amount_kobo,
      requestedPaymentMethod: checkout.effectivePaymentMethod,
    });
    assert.equal(verification.ok, true);
    if (!verification.ok) return;
    assert.equal(verification.planKey, 'pro_weekly');
    assert.equal(verification.createsSubscription, false);
  });

  await run('Flutterwave transfer checkout stays on the manual-renew path', () => {
    const checkout = simulateCheckout({
      gateway: 'flutterwave',
      requestedPlanKey: 'monthly_pro',
      requestedPaymentMethod: 'transfer',
    });
    assert.equal(checkout.ok, true);
    if (!checkout.ok) return;
    assert.equal(checkout.plan.plan_key, 'pro_monthly');
    assert.equal(checkout.effectivePaymentMethod, 'transfer');

    const verification = simulateVerification({
      gateway: 'flutterwave',
      amountKobo: checkout.plan.amount_kobo,
      requestedPaymentMethod: checkout.effectivePaymentMethod,
    });
    assert.equal(verification.ok, true);
    if (!verification.ok) return;
    assert.equal(verification.planKey, 'pro_monthly');
    assert.equal(verification.createsSubscription, false);
  });

  await run('Flutterwave subscription requests are rejected at checkout and coerced to manual handling during recovery', () => {
    const checkout = simulateCheckout({
      gateway: 'flutterwave',
      requestedPlanKey: 'pro_monthly',
      requestedPaymentMethod: 'subscription',
    });
    assert.equal(checkout.ok, false);
    if (checkout.ok) return;
    assert.equal(checkout.error, 'payment_method_not_supported');
    assert.equal(checkout.defaultPaymentMethod, 'transfer');

    const verification = simulateVerification({
      gateway: 'flutterwave',
      amountKobo: 450000,
      requestedPaymentMethod: 'subscription',
    });
    assert.equal(verification.ok, true);
    if (!verification.ok) return;
    assert.equal(verification.planKey, 'pro_monthly');
    assert.equal(verification.effectivePaymentMethod, 'transfer');
    assert.equal(verification.createsSubscription, false);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
