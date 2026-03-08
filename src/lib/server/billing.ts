import { createHash, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeCanonicalBillingPlanKey,
  normalizeEffectiveEntitlementPlan,
} from '@/lib/billing/plans';
import {
  deriveNormalizedSubscriptionState,
  type BillingCheckoutCapability,
} from '@/lib/billing/subscription-state';
import { resolveSubscriptionCancellation } from '@/lib/billing/subscription-cancel';
import {
  BillingApiError,
  assertBillingGatewayCapability,
  getBillingGatewayCapability,
} from '@/lib/server/billing-config';
import { getEffectiveEntitlementsSnapshot } from '@/lib/server/effective-entitlements';
import { firstEnv } from '@/lib/server/env';
import type { PaymentGatewayId, PaymentVerifyResult } from '@/lib/payments/payment-gateway';
import {
  getPaymentGatewayById,
  resolvePaymentGateway,
} from '@/lib/payments/gateway-resolver';
import {
  PROMO_PRO_END_LAGOS_ISO,
  PROMO_PRO_END_UTC_ISO,
  isPromoModeActive,
} from '@/lib/server/promo-entitlements';
import { disablePaystackSubscription } from '@/lib/server/paystack';
import { loadPublicPlanCatalog } from '@/lib/server/au-limits';
import { applyPlanTransition } from '@/lib/server/plan-sync';

export type BillingInterval = 'weekly' | 'monthly';
export type PaymentMethod = 'subscription' | 'transfer';

export type CheckoutResult = {
  authorizationUrl: string;
  reference: string;
};

type BillingPlanRow = {
  plan_key: string;
  interval: BillingInterval;
  amount_kobo: number;
  paystack_plan_code: string | null;
  is_active: boolean;
};

const PLAN_CATALOG: Array<{
  planKey: string;
  interval: BillingInterval;
  amountKobo: number;
  envCodes: string[];
  fallbackPaystackPlanCode: string;
}> = [
  {
    planKey: 'pro_monthly',
    interval: 'monthly',
    amountKobo: 450000,
    envCodes: [
      'PAYSTACK_PLAN_MONTHLY_CODE',
      'PAYSTACK_PRO_MONTHLY_PLAN_CODE',
      'DATACUBE_PRO_MONTHLY_PLAN_CODE',
    ],
    fallbackPaystackPlanCode: 'PLN_axsdw7s4zniurzr',
  },
  {
    planKey: 'pro_weekly',
    interval: 'weekly',
    amountKobo: 150000,
    envCodes: [
      'PAYSTACK_PLAN_WEEKLY_CODE',
      'PAYSTACK_PRO_WEEKLY_PLAN_CODE',
      'DATACUBE_PRO_WEEKLY_PLAN_CODE',
    ],
    fallbackPaystackPlanCode: 'PLN_bc7vhwfff2mqc57',
  },
];

function resolvePlanCodeFromEnv(plan: (typeof PLAN_CATALOG)[number]): string | null {
  return firstEnv(...plan.envCodes);
}

function entitlementDays(interval: BillingInterval): number {
  return interval === 'weekly' ? 7 : 30;
}

function normalizePaymentMethod(raw: unknown): PaymentMethod {
  return String(raw || '').toLowerCase() === 'transfer' ? 'transfer' : 'subscription';
}

function inferChannel(method: PaymentMethod): string {
  return method === 'transfer' ? 'bank_transfer' : 'card';
}

function normalizeInterval(raw: unknown): BillingInterval {
  return normalizeCanonicalBillingPlanKey(raw) === 'pro_weekly' || String(raw || '').toLowerCase() === 'weekly'
    ? 'weekly'
    : 'monthly';
}

function normalizePlanKey(raw: unknown): string {
  const planKey = normalizeCanonicalBillingPlanKey(raw);
  if (planKey === 'pro_weekly' || planKey === 'pro_monthly') {
    return planKey;
  }
  return '';
}

function resolveLatestTransactionPlanKey(rows: any[] | null | undefined): string | null {
  const ordered = rows || [];
  for (const requireSuccess of [true, false]) {
    for (const row of ordered) {
      const status = String((row as any)?.status || '').trim().toLowerCase();
      if (requireSuccess && status !== 'success') continue;
      const metadata = ((row as any)?.metadata || {}) as Record<string, unknown>;
      const planKey = normalizePlanKey(metadata.plan_key);
      if (planKey) return planKey;
    }
  }
  return null;
}

function buildCheckoutCapability(input: {
  billingEnabled: boolean;
  promoActive: boolean;
  gateway: PaymentGatewayId;
}): BillingCheckoutCapability {
  if (!input.billingEnabled) {
    return {
      enabled: false,
      gateway: input.gateway,
      code: 'billing_disabled',
      message: 'Billing is currently disabled.',
    };
  }

  if (input.promoActive) {
    return {
      enabled: false,
      gateway: input.gateway,
      code: 'promo_active',
      message: 'Checkout is unavailable while promo Pro access is active.',
    };
  }

  const gatewayCapability = getBillingGatewayCapability({
    gateway: input.gateway,
    action: 'checkout_initialize',
  });
  if (!gatewayCapability.enabled) {
    return {
      enabled: false,
      gateway: input.gateway,
      code: gatewayCapability.issue?.code || 'billing_gateway_not_configured',
      message: gatewayCapability.issue?.message || 'Checkout is not configured on the server.',
    };
  }

  return {
    enabled: true,
    gateway: input.gateway,
    code: null,
    message: null,
  };
}

function paystackCallbackUrl(origin: string): string {
  return `${resolvePublicOrigin(origin).replace(/\/$/, '')}/dashboard/settings/subscription`;
}

function resolvePublicOrigin(origin: string): string {
  const preferred = firstEnv(
    'NEXT_PUBLIC_SITE_URL',
    'SITE_URL',
    'APP_URL',
    'NEXT_PUBLIC_APP_URL',
    'VERCEL_PROJECT_PRODUCTION_URL',
  );

  if (!preferred) {
    return origin;
  }

  if (/^https?:\/\//i.test(preferred)) {
    return preferred;
  }

  return `https://${preferred}`;
}

function makeReference(planKey: string, userId: string): string {
  const base = `${Date.now()}-${userId}-${planKey}-${randomUUID()}`;
  const digest = createHash('sha1').update(base).digest('hex').slice(0, 12).toUpperCase();
  return `DCAU-${planKey.toUpperCase()}-${digest}`;
}

function webhookIdempotencyKey(payload: any): string {
  const event = String(payload?.event || 'unknown');
  const eventId = String(payload?.id || '').trim();
  if (eventId) return `evt:${eventId}`;
  const ref = String(payload?.data?.reference || payload?.data?.id || '');
  const fingerprint = createHash('sha256')
    .update(`${event}|${ref}|${JSON.stringify(payload?.data || {})}`)
    .digest('hex');
  return `hash:${fingerprint}`;
}

function resolveGatewayFromMetadata(metadata: Record<string, unknown> | null | undefined): PaymentGatewayId {
  if (metadata && typeof metadata === 'object') {
    const rawGateway = (metadata as Record<string, unknown>).gateway;
    if (rawGateway != null) {
      return normalizeGatewayId(rawGateway);
    }
  }
  return 'paystack';
}

function normalizeGatewayId(raw: unknown): PaymentGatewayId {
  return String(raw || '').trim().toLowerCase() === 'flutterwave' ? 'flutterwave' : 'paystack';
}

function asTrimmedString(raw: unknown): string {
  return String(raw || '').trim();
}

function buildGatewayVerificationOrder(
  gatewayHint: PaymentGatewayId | null,
  preferredGateway: PaymentGatewayId | null
): PaymentGatewayId[] {
  const ordered: PaymentGatewayId[] = [];
  const candidates: Array<PaymentGatewayId | null> = [
    gatewayHint,
    preferredGateway,
    resolvePaymentGateway().gateway,
    'paystack',
    'flutterwave',
  ];
  for (const gateway of candidates) {
    if (!gateway || ordered.includes(gateway)) continue;
    ordered.push(gateway);
  }
  return ordered;
}

function isGatewayLookupMiss(error: unknown): boolean {
  const status = Number((error as any)?.status || 0);
  const message = String((error as any)?.message || '').trim().toLowerCase();
  if (status === 404) return true;
  if (status === 400 || status === 422) {
    return /(not found|invalid reference|transaction.*not found|reference.*not found|no transaction)/i.test(message);
  }
  return false;
}

function isGatewayAlreadyCanceledError(error: unknown): boolean {
  const status = Number((error as any)?.status || 0);
  const message = String((error as any)?.message || '').trim().toLowerCase();
  if (status === 404) return true;
  if (status === 400 || status === 409 || status === 422) {
    return /(already disabled|already cancelled|already canceled|not active|subscription.*not found|disabled already)/i.test(message);
  }
  return false;
}

function paymentCallbackUrl(origin: string): string {
  return paystackCallbackUrl(origin);
}

async function upsertSubscriptionMirror(input: {
  supabase: SupabaseClient;
  userId: string;
  status: string;
  plan: string;
  gateway: PaymentGatewayId;
  transactionId: string;
  createdAt: string;
}) {
  const { supabase } = input;
  const row = {
    user_id: input.userId,
    status: input.status,
    plan: input.plan,
    gateway: input.gateway,
    transaction_id: input.transactionId,
    created_at: input.createdAt,
  };
  const { error } = await supabase.from('subscriptions').upsert(row, {
    onConflict: 'transaction_id',
  });
  if (!error) return;
  const code = String((error as any)?.code || '');
  if (code === '42P01') {
    // Keep billing flow resilient before the migration is applied.
    return;
  }
  if (code === '42P10') {
    const { error: insertError } = await supabase.from('subscriptions').insert(row);
    if (!insertError) return;
    const insertCode = String((insertError as any)?.code || '');
    if (insertCode === '23505' || insertCode === '42P01') return;
    throw insertError;
  }
  throw error;
}

async function loadBillingPlan(
  supabase: SupabaseClient,
  planKey: string
): Promise<BillingPlanRow | null> {
  const { data, error } = await supabase
    .from('billing_plans')
    .select('plan_key,interval,amount_kobo,paystack_plan_code,is_active')
    .eq('plan_key', planKey)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    plan_key: String((data as any).plan_key),
    interval: normalizeInterval((data as any).interval),
    amount_kobo: Number((data as any).amount_kobo || 0),
    paystack_plan_code: (data as any).paystack_plan_code ? String((data as any).paystack_plan_code) : null,
    is_active: Boolean((data as any).is_active),
  };
}

async function ensurePlanCatalog(supabase: SupabaseClient): Promise<void> {
  const planKeys = PLAN_CATALOG.map((plan) => plan.planKey);
  const { data: existingRows, error: existingError } = await supabase
    .from('billing_plans')
    .select('plan_key,paystack_plan_code')
    .in('plan_key', planKeys);
  if (existingError) throw existingError;

  const existingCodes = new Map<string, string>();
  for (const row of existingRows || []) {
    const planKey = String((row as any).plan_key || '').trim();
    const code = String((row as any).paystack_plan_code || '').trim();
    if (planKey && code) {
      existingCodes.set(planKey, code);
    }
  }

  const rows = PLAN_CATALOG.map((plan) => ({
    plan_key: plan.planKey,
    interval: plan.interval,
    amount_kobo: plan.amountKobo,
    paystack_plan_code:
      resolvePlanCodeFromEnv(plan) ||
      existingCodes.get(plan.planKey) ||
      plan.fallbackPaystackPlanCode,
    is_active: true,
  }));
  const { error } = await supabase
    .from('billing_plans')
    .upsert(rows, { onConflict: 'plan_key' });
  if (error) throw error;
}

async function writeEntitlementAudit(
  supabase: SupabaseClient,
  payload: {
    userId: string;
    action: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    source: string;
    traceId: string;
  }
) {
  await supabase.from('entitlement_audit').insert({
    user_id: payload.userId,
    action: payload.action,
    before_json: payload.before,
    after_json: payload.after,
    source: payload.source,
    trace_id: payload.traceId,
  });
}

async function grantProEntitlement(input: {
  supabase: SupabaseClient;
  userId: string;
  interval: BillingInterval;
  source: string;
  reason: string;
  traceId: string;
  metadata?: Record<string, unknown>;
}): Promise<{ grantId: string; startsAt: string; endsAt: string }> {
  const now = new Date();
  const nowIso = now.toISOString();
  const { supabase, userId, interval, source, reason, traceId } = input;

  const { data: activeRows, error: activeErr } = await supabase
    .from('entitlement_grants')
    .select('id,ends_at')
    .eq('user_id', userId)
    .eq('entitlement', 'pro')
    .eq('status', 'active')
    .gte('ends_at', nowIso)
    .order('ends_at', { ascending: false })
    .limit(1);
  if (activeErr) throw activeErr;

  const currentEnd = activeRows?.[0] ? new Date(String((activeRows[0] as any).ends_at)).getTime() : null;
  const startMs = currentEnd && Number.isFinite(currentEnd) && currentEnd > now.getTime()
    ? currentEnd
    : now.getTime();
  const days = entitlementDays(interval);
  const endMs = startMs + days * 24 * 60 * 60 * 1000;
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(endMs).toISOString();

  const before = currentEnd
    ? { active_ends_at: new Date(currentEnd).toISOString() }
    : null;
  const after = { active_starts_at: startsAt, active_ends_at: endsAt, interval };

  const { data: grantRow, error: insertErr } = await supabase
    .from('entitlement_grants')
    .insert({
      user_id: userId,
      entitlement: 'pro',
      source,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'active',
      reason,
      metadata: input.metadata || {},
    })
    .select('id')
    .single();
  if (insertErr) throw insertErr;

  await writeEntitlementAudit(supabase, {
    userId,
    action: 'grant',
    before,
    after,
    source,
    traceId,
  });

  return { grantId: String((grantRow as any)?.id || ''), startsAt, endsAt };
}

async function resolveUserIdFromEmail(
  supabase: SupabaseClient,
  email: string | null | undefined
): Promise<string | null> {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('billing_customers')
    .select('user_id')
    .ilike('email', normalized)
    .maybeSingle();
  if (error) return null;
  return data?.user_id ? String(data.user_id) : null;
}

async function markTransaction(input: {
  supabase: SupabaseClient;
  userId: string | null;
  reference: string;
  amountKobo: number;
  channel: string;
  status: string;
  paidAt?: string | null;
  rawEventJson?: Record<string, unknown>;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  const { supabase } = input;
  await supabase.from('billing_transactions').upsert(
    {
      user_id: input.userId,
      reference: input.reference,
      amount_kobo: input.amountKobo,
      channel: input.channel,
      status: input.status,
      paid_at: input.paidAt || null,
      raw_event_json: input.rawEventJson || null,
      idempotency_key: input.idempotencyKey,
      metadata: input.metadata || {},
    },
    { onConflict: 'reference' }
  );
}

export async function createCheckout(input: {
  supabase: SupabaseClient;
  userId: string;
  email: string;
  planKeyRaw: string;
  paymentMethodRaw: unknown;
  origin: string;
}): Promise<CheckoutResult> {
  const { supabase, userId, email, planKeyRaw, paymentMethodRaw, origin } = input;
  await ensurePlanCatalog(supabase);
  const effectiveEntitlements = await getEffectiveEntitlementsSnapshot(supabase, userId);
  if (!effectiveEntitlements.billingEnabled) {
    throw new BillingApiError(503, 'billing_disabled', 'Billing is currently disabled.');
  }
  if (effectiveEntitlements.promoActive) {
    throw new BillingApiError(409, 'promo_active', 'Checkout is unavailable while promo Pro access is active.');
  }

  const planKey = normalizePlanKey(planKeyRaw);
  if (!planKey) {
    throw new BillingApiError(400, 'invalid_plan_key', 'Invalid plan key.');
  }

  const paymentMethod = normalizePaymentMethod(paymentMethodRaw);
  const plan = await loadBillingPlan(supabase, planKey);
  if (!plan) {
    throw new BillingApiError(404, 'plan_not_available', 'Selected plan is not available.');
  }

  const [
    { data: subscriptionRows, error: subscriptionError },
    { data: txRows, error: txError },
    { data: profileRow, error: profileError },
  ] = await Promise.all([
    supabase
      .from('billing_subscriptions')
      .select('plan_key,status')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('billing_transactions')
      .select('metadata')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('au_user_profiles')
      .select('tier')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (subscriptionError) throw subscriptionError;
  if (txError) throw txError;
  if (profileError) throw profileError;

  const currentPlan = deriveNormalizedSubscriptionState({
    effectivePlan: effectiveEntitlements.plan,
    entitlementSource: effectiveEntitlements.entitlementSource,
    promoActive: effectiveEntitlements.promoActive,
    subscriptionPlanKey: subscriptionRows?.[0]?.plan_key,
    subscriptionStatus: subscriptionRows?.[0]?.status,
    latestPaymentPlanKey: resolveLatestTransactionPlanKey(txRows || []),
    legacyTier: (profileRow as any)?.tier ?? effectiveEntitlements.plan,
  });

  if (currentPlan.managedPlan === 'premium') {
    throw new BillingApiError(
      409,
      'premium_plan_managed_separately',
      'Premium subscriptions are managed separately.',
      {
        currentPlanKey: currentPlan.activePlanKey,
      },
    );
  }

  if (
    currentPlan.hasPaidEntitlement &&
    (currentPlan.activePlanKey === planKey || currentPlan.activePlanKey === 'pro')
  ) {
    throw new BillingApiError(
      409,
      'plan_already_active',
      'This plan is already active on your account.',
      {
        requestedPlanKey: planKey,
        currentPlanKey: currentPlan.activePlanKey,
      },
    );
  }

  const gateway = resolvePaymentGateway();
  assertBillingGatewayCapability({ gateway: gateway.gateway, action: 'checkout_initialize' });
  if (gateway.gateway === 'paystack' && paymentMethod === 'subscription' && !plan.paystack_plan_code) {
    throw new BillingApiError(
      503,
      'billing_plan_not_configured',
      'Recurring plan is not configured. Missing Paystack plan code.',
      {
        requestedPlanKey: plan.plan_key,
        gateway: gateway.gateway,
      },
    );
  }

  const reference = makeReference(plan.plan_key, userId);
  const metadata = {
    user_id: userId,
    plan_key: plan.plan_key,
    interval: plan.interval,
    payment_method: paymentMethod,
    source: 'datacube_au',
    gateway: gateway.gateway,
  };

  const channels: Array<'card' | 'bank_transfer'> =
    paymentMethod === 'transfer' ? ['bank_transfer'] : ['card'];

  const response = await gateway.initializePayment({
    email,
    amountKobo: plan.amount_kobo,
    reference,
    callbackUrl: paymentCallbackUrl(origin),
    channels,
    paymentMethod,
    planCode:
      gateway.gateway === 'paystack' && paymentMethod === 'subscription'
        ? plan.paystack_plan_code
        : null,
    metadata,
  });
  const checkoutReference = String(response.reference || reference);

  await supabase.from('billing_customers').upsert(
    {
      user_id: userId,
      email: email.toLowerCase(),
      metadata: {},
    },
    { onConflict: 'user_id' }
  );

  await markTransaction({
    supabase,
    userId,
    reference: checkoutReference,
    amountKobo: plan.amount_kobo,
    channel: inferChannel(paymentMethod),
    status: 'pending',
    rawEventJson: {
      checkout_response: response.raw || null,
    },
    idempotencyKey: `checkout:${checkoutReference}`,
    metadata,
  });

  return {
    authorizationUrl: response.authorizationUrl,
    reference: checkoutReference,
  };
}

export async function verifyCheckoutPayment(input: {
  supabase: SupabaseClient;
  userId: string;
  reference?: string | null;
  verificationTarget?: string | null;
  gatewayHint?: PaymentGatewayId | null;
}): Promise<{
  gateway: PaymentGatewayId;
  reference: string;
  status: string;
  success: boolean;
  amountKobo: number;
}> {
  const reference = asTrimmedString(input.reference);
  const verificationTarget = asTrimmedString(input.verificationTarget) || reference;
  if (!verificationTarget) {
    throw new BillingApiError(400, 'missing_reference', 'A payment reference is required.');
  }

  let existingTx: any = null;
  if (reference) {
    const { data, error } = await input.supabase
      .from('billing_transactions')
      .select('user_id,amount_kobo,metadata,status')
      .eq('reference', reference)
      .maybeSingle();
    if (error) throw error;
    existingTx = data;
  }

  if (existingTx) {
    const existingUserId = asTrimmedString((existingTx as any)?.user_id);
    if (!existingUserId || existingUserId !== input.userId) {
      throw new BillingApiError(403, 'payment_reference_forbidden', 'That payment reference does not belong to this account.');
    }

    const existingMetadata = (((existingTx as any)?.metadata || {}) as Record<string, unknown>) || {};
    const gateway = resolveGatewayFromMetadata(existingMetadata);
    const existingStatus = asTrimmedString((existingTx as any)?.status).toLowerCase();
    const expectedAmountKobo = Math.max(0, Math.round(Number((existingTx as any)?.amount_kobo || 0)));

    if (existingStatus === 'success') {
      return {
        gateway,
        reference,
        status: 'success',
        success: true,
        amountKobo: expectedAmountKobo,
      };
    }

    if (existingStatus === 'failed') {
      return {
        gateway,
        reference,
        status: 'failed',
        success: false,
        amountKobo: expectedAmountKobo,
      };
    }

    let verified: PaymentVerifyResult;
    try {
      verified = await getPaymentGatewayById(gateway).verifyPayment(verificationTarget);
    } catch (error) {
      if (isGatewayLookupMiss(error)) {
        throw new BillingApiError(404, 'payment_reference_not_found', 'We could not verify that payment reference yet.');
      }
      throw error;
    }

    const verifiedAmountKobo = Math.max(0, Math.round(Number(verified.amountKobo || 0)));
    if (expectedAmountKobo > 0 && verifiedAmountKobo > 0 && expectedAmountKobo !== verifiedAmountKobo) {
      throw new BillingApiError(
        409,
        'payment_amount_mismatch',
        'Verified payment amount does not match the pending checkout amount.'
      );
    }
    const verifiedReference = asTrimmedString(verified.reference || reference);
    if (verifiedReference && reference && verifiedReference !== reference) {
      throw new BillingApiError(
        409,
        'payment_reference_mismatch',
        'Verified payment reference does not match the requested checkout reference.'
      );
    }
    const verifiedMetadata = (verified.metadata || {}) as Record<string, unknown>;
    const metadataUserId = asTrimmedString(verifiedMetadata.user_id || existingMetadata.user_id);
    if (metadataUserId && metadataUserId !== input.userId) {
      throw new BillingApiError(
        403,
        'payment_user_mismatch',
        'Verified payment user does not match the authenticated account.'
      );
    }
    const mergedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      ...verifiedMetadata,
      user_id: input.userId,
      gateway,
    };

    await handleSuccessfulPayment({
      supabase: input.supabase,
      gateway,
      verified: {
        ...verified,
        reference: verified.reference || reference,
        metadata: mergedMetadata,
      },
      payload: {
        event: 'api.verify',
        data: {
          reference: verified.reference || reference,
          metadata: mergedMetadata,
          amount: verified.amountKobo,
          channel: verified.channel,
          customer: {
            email: verified.customerEmail,
          },
        },
      },
      idempotencyKey: `verify:${verified.reference || reference || verificationTarget}`,
      traceId: `verify-${reference || verificationTarget}`,
    });

    return {
      gateway,
      reference: verified.reference || reference,
      status: verified.success ? 'success' : verified.status,
      success: verified.success,
      amountKobo: verified.amountKobo,
    };
  }

  let verifiedResult: { gateway: PaymentGatewayId; verified: PaymentVerifyResult } | null = null;
  let lastError: unknown = null;
  for (const gateway of buildGatewayVerificationOrder(input.gatewayHint || null, null)) {
    try {
      const verified = await getPaymentGatewayById(gateway).verifyPayment(verificationTarget);
      verifiedResult = { gateway, verified };
      break;
    } catch (error) {
      if (isGatewayLookupMiss(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (!verifiedResult) {
    if (lastError && isGatewayLookupMiss(lastError)) {
      throw new BillingApiError(404, 'payment_reference_not_found', 'We could not verify that payment reference yet.');
    }
    throw new BillingApiError(404, 'payment_reference_not_found', 'Payment reference was not found.');
  }

  const verifiedMetadata = (verifiedResult.verified.metadata || {}) as Record<string, unknown>;
  const metadataUserId = asTrimmedString(verifiedMetadata.user_id);
  if (!metadataUserId || metadataUserId !== input.userId) {
    throw new BillingApiError(
      403,
      'payment_reference_forbidden',
      'That payment reference does not belong to this account.'
    );
  }

  const mergedMetadata: Record<string, unknown> = {
    ...verifiedMetadata,
    user_id: input.userId,
    gateway: verifiedResult.gateway,
  };

  const resolvedReference = asTrimmedString(verifiedResult.verified.reference || reference || verificationTarget);
  await handleSuccessfulPayment({
    supabase: input.supabase,
    gateway: verifiedResult.gateway,
    verified: {
      ...verifiedResult.verified,
      reference: resolvedReference,
      metadata: mergedMetadata,
    },
    payload: {
      event: 'api.verify.recovered',
      data: {
        reference: resolvedReference,
        metadata: mergedMetadata,
        amount: verifiedResult.verified.amountKobo,
        channel: verifiedResult.verified.channel,
        customer: {
          email: verifiedResult.verified.customerEmail,
        },
      },
    },
    idempotencyKey: `verify:${resolvedReference}`,
    traceId: `verify-${resolvedReference}`,
  });

  return {
    gateway: verifiedResult.gateway,
    reference: resolvedReference,
    status: verifiedResult.verified.success ? 'success' : verifiedResult.verified.status,
    success: verifiedResult.verified.success,
    amountKobo: verifiedResult.verified.amountKobo,
  };
}

export async function getBillingStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<Record<string, unknown>> {
  await ensurePlanCatalog(supabase);

  const effectiveEntitlements = await getEffectiveEntitlementsSnapshot(supabase, userId);
  const { data: profileRow } = await supabase
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', userId)
    .maybeSingle();
  const profileTierRaw = (profileRow as any)?.tier;
  const currentTier = normalizeEffectiveEntitlementPlan(profileTierRaw);

  if (currentTier !== 'admin' && effectiveEntitlements.plan !== 'admin') {
    await applyPlanTransition(supabase, {
      userId,
      targetPlan: effectiveEntitlements.plan === 'premium' ? 'premium' : (effectiveEntitlements.hasPro ? 'pro' : 'free'),
      entitlementSource: effectiveEntitlements.entitlementSource,
      entitlementEndsAt: effectiveEntitlements.entitlementEndsAt,
      transitionKind: 'sync',
      source: 'billing_status',
      reason: 'status_sync',
      metadata: {
        billing_enabled: effectiveEntitlements.billingEnabled,
      },
    });
  }

  const { data: subscriptions, error: subError } = await supabase
    .from('billing_subscriptions')
    .select('plan_key,status,starts_at,ends_at,cancel_at_period_end,metadata,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (subError) throw subError;

  const { data: txs, error: txError } = await supabase
    .from('billing_transactions')
    .select('reference,status,amount_kobo,channel,paid_at,created_at,metadata')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (txError) throw txError;

  const planCatalog = await loadPublicPlanCatalog(supabase).catch(() => []);
  const proCatalog = planCatalog.find((entry) => entry.plan === 'pro');
  const pricing: Record<string, unknown> = {};
  if (proCatalog?.pricing.monthly) {
    pricing.monthly = {
      amount: proCatalog.pricing.monthly.amount,
      compare_at: proCatalog.pricing.monthly.compare_at,
      label: proCatalog.pricing.monthly.label,
      plan_key: proCatalog.pricing.monthly.plan_key,
    };
  }
  if (proCatalog?.pricing.weekly) {
    pricing.weekly = {
      amount: proCatalog.pricing.weekly.amount,
      compare_at: proCatalog.pricing.weekly.compare_at,
      label: proCatalog.pricing.weekly.label,
      plan_key: proCatalog.pricing.weekly.plan_key,
    };
  }

  const currentSubscription = subscriptions?.[0] || null;
  const currentPlan = deriveNormalizedSubscriptionState({
    effectivePlan: effectiveEntitlements.plan,
    entitlementSource: effectiveEntitlements.entitlementSource,
    promoActive: effectiveEntitlements.promoActive,
    subscriptionPlanKey: currentSubscription?.plan_key,
    subscriptionStatus: currentSubscription?.status,
    latestPaymentPlanKey: resolveLatestTransactionPlanKey(txs || []),
    legacyTier: profileTierRaw ?? currentTier,
  });
  const gateway = resolvePaymentGateway();
  const checkout = buildCheckoutCapability({
    billingEnabled: effectiveEntitlements.billingEnabled,
    promoActive: effectiveEntitlements.promoActive,
    gateway: gateway.gateway,
  });
  const payments = (txs || []).map((row: any) => ({
    reference: row.reference,
    status: row.status,
    amount_ngn: Math.round(Number(row.amount_kobo || 0) / 100),
    channel: row.channel,
    created_at: row.created_at,
    paid_at: row.paid_at,
    plan_key: normalizePlanKey((row.metadata || {}).plan_key) || null,
    plan: String((row.metadata || {}).plan_key || '').replace('pro_', '') || 'pro',
  }));

  return {
    billingEnabled: effectiveEntitlements.billingEnabled,
    canAccessBilling: effectiveEntitlements.canAccessBilling,
    tier: currentPlan.managedPlan,
    entitlementPlan: effectiveEntitlements.plan,
    entitlementSource: effectiveEntitlements.entitlementSource,
    tier_expires_at: effectiveEntitlements.entitlementEndsAt,
    promo: {
      active: effectiveEntitlements.promoActive,
      ends_at_lagos: PROMO_PRO_END_LAGOS_ISO,
      ends_at_utc: PROMO_PRO_END_UTC_ISO,
    },
    currentPlan,
    checkout,
    pricing,
    planCatalog,
    subscription: currentSubscription,
    payments,
  };
}

export async function cancelUserSubscription(
  supabase: SupabaseClient,
  userId: string,
  options?: {
    reason?: string | null;
  }
): Promise<{
  outcome: 'scheduled' | 'already_scheduled' | 'no_subscription';
  message: string;
}> {
  const { data: subscription, error } = await supabase
    .from('billing_subscriptions')
    .select('paystack_subscription_code,paystack_email_token,status,metadata,cancel_at_period_end')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!subscription) {
    return {
      outcome: 'no_subscription',
      message: 'No active subscription was found for this account.',
    };
  }

  const code = String((subscription as any).paystack_subscription_code || '').trim();
  const token = String((subscription as any).paystack_email_token || '').trim();
  const metadata = ((subscription as any)?.metadata || {}) as Record<string, unknown>;
  const gateway = resolveGatewayFromMetadata(metadata);
  const resolution = resolveSubscriptionCancellation({
    status: (subscription as any)?.status,
    cancelAtPeriodEnd: (subscription as any)?.cancel_at_period_end === true,
    gateway,
    paystackSubscriptionCode: code,
    paystackEmailToken: token,
  });
  if (resolution.mode === 'noop') {
    return {
      outcome: resolution.reason === 'no_subscription' ? 'no_subscription' : 'already_scheduled',
      message:
        resolution.reason === 'no_subscription'
          ? 'No active subscription was found for this account.'
          : 'Auto-renew is already turned off for this subscription.',
    };
  }

  if (resolution.mode === 'remote_cancel') {
    try {
      await disablePaystackSubscription({ code, token });
    } catch (error) {
      if (!isGatewayAlreadyCanceledError(error)) {
        throw new BillingApiError(
          502,
          'subscription_cancel_failed',
          'The billing provider could not confirm the cancellation request right now.'
        );
      }
    }
  }

  const canceledAt = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    canceled_at: canceledAt,
    canceled_by: 'user',
    cancel_reason: asTrimmedString(options?.reason) || null,
    gateway_cancel_mode: resolution.mode,
    gateway_cancel_reason: resolution.reason,
  };

  const { error: updateError } = await supabase
    .from('billing_subscriptions')
    .update({
      status: 'non_renewing',
      cancel_at_period_end: true,
      metadata: nextMetadata,
    })
    .eq('user_id', userId);
  if (updateError) throw updateError;

  return {
    outcome: 'scheduled',
    message: 'Auto-renew has been turned off for this subscription.',
  };
}

async function insertWebhookEvent(
  supabase: SupabaseClient,
  payload: any
): Promise<{ isDuplicate: boolean; key: string }> {
  const key = webhookIdempotencyKey(payload);
  const event = String(payload?.event || 'unknown');
  const ref = String(payload?.data?.reference || payload?.data?.tx_ref || '');
  const id = String(payload?.id || payload?.data?.id || '');

  const { error } = await supabase.from('billing_webhook_events').insert({
    event_id: id || null,
    event_type: event,
    reference: ref || null,
    idempotency_key: key,
    payload,
    status: 'received',
    processed_at: new Date().toISOString(),
  });

  if (!error) return { isDuplicate: false, key };
  if (String((error as any)?.code || '') === '23505') {
    return { isDuplicate: true, key };
  }
  throw error;
}

async function handleSuccessfulPayment(input: {
  supabase: SupabaseClient;
  gateway: PaymentGatewayId;
  verified: PaymentVerifyResult;
  payload: any;
  idempotencyKey: string;
  traceId: string;
}) {
  const { supabase, gateway, verified, payload, idempotencyKey, traceId } = input;
  const reference = String(verified.reference || payload?.data?.reference || '').trim();
  if (!reference) return;

  const metadata = (verified.metadata || payload?.data?.metadata || {}) as Record<string, unknown>;
  const planKey = normalizePlanKey(metadata.plan_key);
  const userIdFromMetadata = String(metadata.user_id || '').trim();
  const customerEmail = String(verified.customerEmail || '').trim().toLowerCase();
  const userIdFromCustomer = await resolveUserIdFromEmail(supabase, customerEmail);
  const userId = userIdFromMetadata || userIdFromCustomer || null;
  const transactionId = String(verified.gatewayTransactionId || reference);

  const transactionMetadata: Record<string, unknown> = {
    ...metadata,
    gateway,
    gateway_transaction_id: transactionId,
    authorization_code: verified.authorizationCode || null,
    customer_code: verified.customerCode || null,
    subscription_code: verified.subscriptionCode || null,
    subscription_email_token: verified.subscriptionEmailToken || null,
  };

  await markTransaction({
    supabase,
    userId,
    reference,
    amountKobo: Number(verified.amountKobo || 0),
    channel: String(verified.channel || payload?.data?.channel || 'unknown'),
    status: verified.success ? 'success' : String(verified.status || 'pending'),
    paidAt: verified.paidAt || null,
    rawEventJson: payload,
    idempotencyKey,
    metadata: transactionMetadata,
  });

  if (!verified.success || !userId || !planKey) {
    return;
  }

  await supabase.from('billing_customers').upsert(
    {
      user_id: userId,
      email: customerEmail || null,
      paystack_customer_code: gateway === 'paystack' ? (verified.customerCode || null) : null,
      metadata:
        gateway === 'paystack'
          ? {
              latest_authorization_code: verified.authorizationCode || null,
            }
          : {
              gateway,
              latest_transaction_id: transactionId,
            },
    },
    { onConflict: 'user_id' }
  );

  const plan = await loadBillingPlan(supabase, planKey);
  if (!plan) return;

  const chargeMethod = normalizePaymentMethod(metadata.payment_method);
  const grant = await grantProEntitlement({
    supabase,
    userId,
    interval: plan.interval,
    source: `${gateway}:${chargeMethod}`,
    reason: `charge.success:${reference}`,
    traceId,
    metadata: {
      reference,
      plan_key: planKey,
      gateway,
      transaction_id: transactionId,
    },
  });

  try {
    await applyPlanTransition(supabase, {
      userId,
      targetPlan: 'pro',
      entitlementSource: 'paid',
      entitlementEndsAt: grant.endsAt,
      source: `${gateway}:${chargeMethod}`,
      reason: `charge.success:${reference}`,
      traceId,
      metadata: {
        reference,
        plan_key: planKey,
        gateway,
        transaction_id: transactionId,
      },
      subscription: chargeMethod === 'subscription'
        ? {
            planKey: plan.plan_key,
            status: 'active',
            paystackSubscriptionCode: gateway === 'paystack' ? (verified.subscriptionCode || null) : null,
            paystackEmailToken: gateway === 'paystack' ? (verified.subscriptionEmailToken || null) : null,
            startsAt: grant.startsAt,
            endsAt: grant.endsAt,
            cancelAtPeriodEnd: false,
            metadata: {
              latest_reference: reference,
              gateway,
              transaction_id: transactionId,
            },
          }
        : null,
    });
  } catch (error) {
    if (grant.grantId) {
      await supabase.from('entitlement_grants').delete().eq('id', grant.grantId);
    }
    throw error;
  }

  await upsertSubscriptionMirror({
    supabase,
    userId,
    status: 'active',
    plan: plan.plan_key,
    gateway,
    transactionId,
    createdAt: verified.paidAt || new Date().toISOString(),
  });
}

async function processSuccessfulCharge(input: {
  supabase: SupabaseClient;
  payload: any;
  idempotencyKey: string;
  traceId: string;
  gateway: PaymentGatewayId;
  verifyTarget?: string | null;
}) {
  const { supabase, payload, idempotencyKey, traceId, gateway, verifyTarget } = input;
  const reference = String(verifyTarget || payload?.data?.reference || '').trim();
  if (!reference) return;

  const verified = await getPaymentGatewayById(gateway).verifyPayment(reference);
  await handleSuccessfulPayment({
    supabase,
    gateway,
    verified,
    payload,
    idempotencyKey,
    traceId,
  });
}

async function processFailedCharge(input: {
  supabase: SupabaseClient;
  payload: any;
  idempotencyKey: string;
  gateway: PaymentGatewayId;
}) {
  const { supabase, payload, idempotencyKey, gateway } = input;
  const reference = String(payload?.data?.reference || payload?.data?.tx_ref || '').trim();
  const amountRaw = Number(payload?.data?.amount || 0);
  const amount = gateway === 'flutterwave' ? Math.round(amountRaw * 100) : amountRaw;
  const channel = String(payload?.data?.channel || payload?.data?.payment_type || 'unknown');
  const email = String(payload?.data?.customer?.email || '').trim().toLowerCase();
  const userId = await resolveUserIdFromEmail(supabase, email);

  if (!reference) return;

  await markTransaction({
    supabase,
    userId,
    reference,
    amountKobo: amount,
    channel,
    status: 'failed',
    paidAt: null,
    rawEventJson: payload,
    idempotencyKey,
    metadata: {
      event: payload?.event,
      gateway,
    },
  });
}

async function processSubscriptionEvent(input: {
  supabase: SupabaseClient;
  payload: any;
  traceId: string;
}) {
  const { supabase, payload, traceId } = input;
  const eventType = String(payload?.event || '');
  const data = payload?.data || {};
  const customerEmail = String(data?.customer?.email || '').trim().toLowerCase();
  const userId = (await resolveUserIdFromEmail(supabase, customerEmail)) || String(data?.metadata?.user_id || '').trim();
  if (!userId) return;

  const subscriptionCode = String(data?.subscription_code || data?.code || '').trim();
  const emailToken = String(data?.email_token || '').trim();
  const planKey = normalizePlanKey(data?.plan?.name || data?.metadata?.plan_key || '');

  let status = 'active';
  let cancelAtPeriodEnd = false;
  if (eventType === 'subscription.disable') {
    status = 'canceled';
    cancelAtPeriodEnd = true;
  } else if (eventType === 'subscription.not_renew' || eventType === 'invoice.payment_failed') {
    status = 'non_renewing';
    cancelAtPeriodEnd = true;
  }

  await supabase.from('billing_subscriptions').upsert(
    {
      user_id: userId,
      plan_key: planKey || 'pro_monthly',
      status,
      paystack_subscription_code: subscriptionCode || null,
      paystack_email_token: emailToken || null,
      cancel_at_period_end: cancelAtPeriodEnd,
      metadata: {
        ...data,
        gateway: 'paystack',
      },
    },
    { onConflict: 'user_id' }
  );

  await writeEntitlementAudit(supabase, {
    userId,
    action: `subscription_event:${eventType}`,
    before: null,
    after: {
      status,
      cancel_at_period_end: cancelAtPeriodEnd,
      subscription_code: subscriptionCode || null,
    },
    source: 'paystack_webhook',
    traceId,
  });
}

export async function processPaystackWebhook(input: {
  supabase: SupabaseClient;
  payload: any;
  traceId: string;
}): Promise<{ duplicate: boolean; event: string }> {
  const { supabase, payload, traceId } = input;
  const event = String(payload?.event || 'unknown');
  const inserted = await insertWebhookEvent(supabase, payload);
  if (inserted.isDuplicate) {
    return { duplicate: true, event };
  }

  if (event === 'charge.success') {
    await processSuccessfulCharge({
      supabase,
      payload,
      idempotencyKey: inserted.key,
      traceId,
      gateway: 'paystack',
    });
  } else if (
    event === 'charge.failed' ||
    event === 'transfer.failed' ||
    event === 'bank.transfer.rejected'
  ) {
    await processFailedCharge({
      supabase,
      payload,
      idempotencyKey: inserted.key,
      gateway: 'paystack',
    });
  } else if (
    event === 'subscription.create' ||
    event === 'subscription.disable' ||
    event === 'subscription.not_renew' ||
    event === 'invoice.payment_failed' ||
    event === 'invoice.update'
  ) {
    await processSubscriptionEvent({
      supabase,
      payload,
      traceId,
    });
  }

  return { duplicate: false, event };
}

function normalizeFlutterwaveWebhookPayload(payload: any): any {
  const data = payload?.data || {};
  const reference = String(data?.tx_ref || data?.reference || '').trim();
  return {
    ...payload,
    event: String(payload?.event || payload?.type || 'unknown'),
    id: payload?.id || data?.id || reference || null,
    data: {
      ...data,
      reference,
    },
  };
}

function isFailedPaymentStatus(status: string): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'failed' || normalized === 'abandoned' || normalized === 'cancelled' || normalized === 'canceled';
}

export async function processFlutterwaveWebhook(input: {
  supabase: SupabaseClient;
  payload: any;
  traceId: string;
}): Promise<{ duplicate: boolean; event: string }> {
  const { supabase, payload, traceId } = input;
  const normalizedPayload = normalizeFlutterwaveWebhookPayload(payload);
  const event = String(normalizedPayload?.event || 'unknown');
  const inserted = await insertWebhookEvent(supabase, normalizedPayload);
  if (inserted.isDuplicate) {
    return { duplicate: true, event };
  }

  const transactionId = String(normalizedPayload?.data?.id || '').trim();
  const reference = String(normalizedPayload?.data?.reference || '').trim();
  const verifyTarget = transactionId || reference;
  if (!verifyTarget) {
    return { duplicate: false, event };
  }

  const verified = await getPaymentGatewayById('flutterwave').verifyPayment(verifyTarget);
  if (verified.success) {
    await handleSuccessfulPayment({
      supabase,
      gateway: 'flutterwave',
      verified,
      payload: normalizedPayload,
      idempotencyKey: inserted.key,
      traceId,
    });
    return { duplicate: false, event };
  }

  if (isFailedPaymentStatus(verified.status)) {
    await processFailedCharge({
      supabase,
      payload: {
        ...normalizedPayload,
        data: {
          ...normalizedPayload.data,
          amount: Number(verified.amountKobo || 0) / 100,
          channel: verified.channel,
          customer: {
            email: verified.customerEmail,
          },
        },
      },
      idempotencyKey: inserted.key,
      gateway: 'flutterwave',
    });
  }

  return { duplicate: false, event };
}

export async function reconcileBilling(
  supabase: SupabaseClient
): Promise<{ verifiedPending: number; expiredGrants: number; downgradedUsers: number }> {
  await ensurePlanCatalog(supabase);
  const nowIso = new Date().toISOString();
  let verifiedPending = 0;

  const pendingCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pendingTx, error: pendingErr } = await supabase
    .from('billing_transactions')
    .select('reference,metadata')
    .in('status', ['pending', 'initiated'])
    .lt('created_at', pendingCutoff)
    .order('created_at', { ascending: true })
    .limit(200);
  if (pendingErr) throw pendingErr;

  for (const row of pendingTx || []) {
    const reference = String((row as any).reference || '').trim();
    if (!reference) continue;
    try {
      const metadata = ((row as any).metadata || {}) as Record<string, unknown>;
      const gateway = resolveGatewayFromMetadata(metadata);
      const verified = await getPaymentGatewayById(gateway).verifyPayment(reference);
      if (verified.success) {
        await handleSuccessfulPayment({
          supabase,
          gateway,
          verified,
          payload: {
            event: 'reconcile.charge.success',
            data: {
              reference: verified.reference || reference,
              metadata: {
                ...metadata,
                ...(verified.metadata || {}),
                gateway,
              },
              customer: {
                email: verified.customerEmail,
              },
              channel: verified.channel,
              amount: verified.amountKobo,
              paid_at: verified.paidAt,
            },
          },
          idempotencyKey: `reconcile:${reference}`,
          traceId: `reconcile-${reference}`,
        });
        verifiedPending += 1;
      } else if (isFailedPaymentStatus(verified.status)) {
        await supabase
          .from('billing_transactions')
          .update({ status: 'failed' })
          .eq('reference', reference);
      }
    } catch {
      // Keep pending for next reconciliation cycle.
    }
  }

  const { data: expiredRows, error: expiredErr } = await supabase
    .from('entitlement_grants')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('ends_at', nowIso)
    .select('user_id');
  if (expiredErr) throw expiredErr;
  const expiredGrants = expiredRows?.length || 0;

  await supabase
    .from('billing_subscriptions')
    .update({ status: 'expired' })
    .in('status', ['active', 'non_renewing'])
    .eq('cancel_at_period_end', true)
    .lt('ends_at', nowIso);

  let downgradedUsers = 0;
  const promoModeActive = await isPromoModeActive(supabase);
  if (!promoModeActive) {
    const { data: proProfiles, error: profileErr } = await supabase
      .from('au_user_profiles')
      .select('user_id')
      .eq('tier', 'pro');
    if (profileErr) throw profileErr;

    for (const row of proProfiles || []) {
      const userId = String((row as any).user_id || '').trim();
      if (!userId) continue;
      const effectiveEntitlements = await getEffectiveEntitlementsSnapshot(supabase, userId);
      if (!effectiveEntitlements.hasPro) {
        await applyPlanTransition(supabase, {
          userId,
          targetPlan: 'free',
          entitlementSource: 'none',
          entitlementEndsAt: null,
          transitionKind: 'downgrade',
          source: 'billing_reconcile',
          reason: 'pro_expired',
          traceId: `reconcile-downgrade-${userId}`,
          metadata: {
            reconciled_at: nowIso,
          },
        });
        downgradedUsers += 1;
      }
    }
  }

  return { verifiedPending, expiredGrants, downgradedUsers };
}
