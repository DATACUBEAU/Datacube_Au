import { createHash, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatureFlagBoolean } from '@/lib/server/feature-flags';
import { firstEnv } from '@/lib/server/supabase-admin';
import {
  PROMO_PRO_END_LAGOS_ISO,
  getProEntitlementStatus,
  isPromoModeActive,
} from '@/lib/server/entitlements';
import {
  disablePaystackSubscription,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from '@/lib/server/paystack';

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
  return String(raw || '').toLowerCase() === 'weekly' ? 'weekly' : 'monthly';
}

function normalizePlanKey(raw: unknown): string {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'weekly' || v === 'pro_weekly') return 'pro_weekly';
  if (v === 'monthly' || v === 'pro_monthly') return 'pro_monthly';
  return '';
}

function paystackCallbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/dashboard/settings/subscription`;
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

async function setProfileTier(
  supabase: SupabaseClient,
  userId: string,
  tier: 'free' | 'pro',
  expiresAt: string | null
) {
  await supabase
    .from('au_user_profiles')
    .upsert(
      {
        user_id: userId,
        tier,
        tier_expires_at: expiresAt,
      },
      { onConflict: 'user_id' }
    );
}

async function grantProEntitlement(input: {
  supabase: SupabaseClient;
  userId: string;
  interval: BillingInterval;
  source: string;
  reason: string;
  traceId: string;
  metadata?: Record<string, unknown>;
}): Promise<{ startsAt: string; endsAt: string }> {
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

  const { error: insertErr } = await supabase.from('entitlement_grants').insert({
    user_id: userId,
    entitlement: 'pro',
    source,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'active',
    reason,
    metadata: input.metadata || {},
  });
  if (insertErr) throw insertErr;

  await writeEntitlementAudit(supabase, {
    userId,
    action: 'grant',
    before,
    after,
    source,
    traceId,
  });

  await setProfileTier(supabase, userId, 'pro', endsAt);
  return { startsAt, endsAt };
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

  const planKey = normalizePlanKey(planKeyRaw);
  if (!planKey) {
    throw new Error('Invalid plan key.');
  }

  const paymentMethod = normalizePaymentMethod(paymentMethodRaw);
  const plan = await loadBillingPlan(supabase, planKey);
  if (!plan) {
    throw new Error('Selected plan is not available.');
  }
  if (paymentMethod === 'subscription' && !plan.paystack_plan_code) {
    throw new Error('Recurring plan is not configured. Missing Paystack plan code.');
  }

  const reference = makeReference(plan.plan_key, userId);
  const metadata = {
    user_id: userId,
    plan_key: plan.plan_key,
    interval: plan.interval,
    payment_method: paymentMethod,
    source: 'datacube_au',
  };

  const channels: Array<'card' | 'bank_transfer'> =
    paymentMethod === 'transfer' ? ['bank_transfer'] : ['card'];

  const response = await initializePaystackTransaction({
    email,
    amountKobo: plan.amount_kobo,
    reference,
    callbackUrl: paystackCallbackUrl(origin),
    channels,
    planCode: paymentMethod === 'subscription' ? plan.paystack_plan_code : null,
    metadata,
  });

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
    reference,
    amountKobo: plan.amount_kobo,
    channel: inferChannel(paymentMethod),
    status: 'pending',
    rawEventJson: {
      checkout_response: response.data,
    },
    idempotencyKey: `checkout:${reference}`,
    metadata,
  });

  return {
    authorizationUrl: response.data.authorization_url,
    reference,
  };
}

export async function getBillingStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<Record<string, unknown>> {
  await ensurePlanCatalog(supabase);

  const billingEnabled = await getFeatureFlagBoolean(supabase, 'billing_enabled', false);
  const { data: profileRow } = await supabase
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', userId)
    .maybeSingle();
  const currentTier = String((profileRow as any)?.tier || '').toLowerCase();
  const entitlement = await getProEntitlementStatus(supabase, userId);

  if (currentTier !== 'admin' && entitlement.hasPro) {
    await setProfileTier(supabase, userId, 'pro', entitlement.endsAt);
  } else if (currentTier !== 'admin' && !entitlement.hasPro) {
    await setProfileTier(supabase, userId, 'free', null);
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

  const pricing: Record<string, unknown> = {};
  for (const def of PLAN_CATALOG) {
    pricing[def.interval] = {
      amount: Math.round(def.amountKobo / 100),
      compare_at: def.interval === 'monthly' ? 6000 : 2500,
      label: def.interval === 'monthly' ? 'Save 25%' : 'Save 40%',
      plan_key: def.planKey,
    };
  }

  const tier = entitlement.hasPro ? 'pro' : 'free';
  const payments = (txs || []).map((row: any) => ({
    reference: row.reference,
    status: row.status,
    amount_ngn: Math.round(Number(row.amount_kobo || 0) / 100),
    channel: row.channel,
    created_at: row.created_at,
    paid_at: row.paid_at,
    plan: String((row.metadata || {}).plan_key || '').replace('pro_', '') || 'pro',
  }));

  return {
    billingEnabled,
    canAccessBilling: billingEnabled && !entitlement.promoActive,
    tier,
    entitlementSource: entitlement.source,
    tier_expires_at: entitlement.endsAt,
    promo: {
      active: entitlement.promoActive,
      ends_at_lagos: PROMO_PRO_END_LAGOS_ISO,
      ends_at_utc: '2026-04-01T23:00:00.000Z',
    },
    pricing,
    subscription: subscriptions?.[0] || null,
    payments,
  };
}

export async function cancelUserSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: subscription, error } = await supabase
    .from('billing_subscriptions')
    .select('paystack_subscription_code,paystack_email_token,status')
    .eq('user_id', userId)
    .in('status', ['active', 'non_renewing'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!subscription) throw new Error('No active subscription found.');

  const code = String((subscription as any).paystack_subscription_code || '');
  const token = String((subscription as any).paystack_email_token || '');
  if (!code || !token) {
    throw new Error('Subscription cannot be canceled automatically (missing Paystack token).');
  }

  await disablePaystackSubscription({ code, token });

  await supabase
    .from('billing_subscriptions')
    .update({
      status: 'non_renewing',
      cancel_at_period_end: true,
      metadata: {
        canceled_at: new Date().toISOString(),
        canceled_by: 'user',
      },
    })
    .eq('user_id', userId)
    .eq('paystack_subscription_code', code);
}

async function insertWebhookEvent(
  supabase: SupabaseClient,
  payload: any
): Promise<{ isDuplicate: boolean; key: string }> {
  const key = webhookIdempotencyKey(payload);
  const event = String(payload?.event || 'unknown');
  const ref = String(payload?.data?.reference || '');
  const id = String(payload?.id || '');

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

async function processSuccessfulCharge(input: {
  supabase: SupabaseClient;
  payload: any;
  idempotencyKey: string;
  traceId: string;
}) {
  const { supabase, payload, idempotencyKey, traceId } = input;
  const reference = String(payload?.data?.reference || '').trim();
  if (!reference) return;

  const verified = await verifyPaystackTransaction(reference);
  const verifiedData = verified.data;
  const metadata = (verifiedData.metadata || payload?.data?.metadata || {}) as Record<string, unknown>;
  const planKey = normalizePlanKey(metadata.plan_key);
  const userIdFromMetadata = String(metadata.user_id || '').trim();
  const customerEmail = String(verifiedData.customer?.email || '').trim().toLowerCase();
  const userIdFromCustomer = await resolveUserIdFromEmail(supabase, customerEmail);
  const userId = userIdFromMetadata || userIdFromCustomer || null;

  const transactionMetadata: Record<string, unknown> = {
    ...metadata,
    paystack_authorization_code: verifiedData.authorization?.authorization_code || null,
    paystack_customer_code: verifiedData.customer?.customer_code || null,
    paystack_subscription: verifiedData.subscription || null,
  };

  await markTransaction({
    supabase,
    userId,
    reference,
    amountKobo: Number(verifiedData.amount || 0),
    channel: String(verifiedData.channel || payload?.data?.channel || 'unknown'),
    status: String(verifiedData.status || 'success'),
    paidAt: verifiedData.paid_at || null,
    rawEventJson: payload,
    idempotencyKey,
    metadata: transactionMetadata,
  });

  if (!userId || !planKey) {
    return;
  }

  await supabase.from('billing_customers').upsert(
    {
      user_id: userId,
      email: customerEmail || null,
      paystack_customer_code: verifiedData.customer?.customer_code || null,
      metadata: {
        latest_authorization_code: verifiedData.authorization?.authorization_code || null,
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
    source: `paystack:${chargeMethod}`,
    reason: `charge.success:${reference}`,
    traceId,
    metadata: {
      reference,
      plan_key: planKey,
    },
  });

  if (chargeMethod === 'subscription') {
    const subscriptionRaw = payload?.data?.subscription;
    const paystackSubscriptionCode =
      typeof subscriptionRaw === 'string'
        ? subscriptionRaw
        : String(subscriptionRaw?.subscription_code || metadata.subscription_code || '');
    const paystackEmailToken = String(subscriptionRaw?.email_token || metadata.paystack_email_token || '');
    await supabase.from('billing_subscriptions').upsert(
      {
        user_id: userId,
        plan_key: plan.plan_key,
        status: 'active',
        paystack_subscription_code: paystackSubscriptionCode || null,
        paystack_email_token: paystackEmailToken || null,
        starts_at: grant.startsAt,
        ends_at: grant.endsAt,
        cancel_at_period_end: false,
        metadata: {
          latest_reference: reference,
        },
      },
      { onConflict: 'user_id' }
    );
  }
}

async function processFailedCharge(input: {
  supabase: SupabaseClient;
  payload: any;
  idempotencyKey: string;
}) {
  const { supabase, payload, idempotencyKey } = input;
  const reference = String(payload?.data?.reference || '').trim();
  const amount = Number(payload?.data?.amount || 0);
  const channel = String(payload?.data?.channel || 'unknown');
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
      metadata: data,
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

export async function reconcileBilling(
  supabase: SupabaseClient
): Promise<{ verifiedPending: number; expiredGrants: number; downgradedUsers: number }> {
  await ensurePlanCatalog(supabase);
  const nowIso = new Date().toISOString();
  let verifiedPending = 0;

  const pendingCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pendingTx, error: pendingErr } = await supabase
    .from('billing_transactions')
    .select('reference')
    .in('status', ['pending', 'initiated'])
    .lt('created_at', pendingCutoff)
    .order('created_at', { ascending: true })
    .limit(200);
  if (pendingErr) throw pendingErr;

  for (const row of pendingTx || []) {
    const reference = String((row as any).reference || '').trim();
    if (!reference) continue;
    try {
      const verified = await verifyPaystackTransaction(reference);
      if (String(verified.data.status).toLowerCase() === 'success') {
        await processSuccessfulCharge({
          supabase,
          payload: {
            event: 'reconcile.charge.success',
            data: {
              reference,
              metadata: verified.data.metadata || {},
              customer: verified.data.customer || {},
              channel: verified.data.channel,
              amount: verified.data.amount,
              paid_at: verified.data.paid_at,
            },
          },
          idempotencyKey: `reconcile:${reference}`,
          traceId: `reconcile-${reference}`,
        });
        verifiedPending += 1;
      } else if (String(verified.data.status).toLowerCase() === 'failed') {
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
      const entitlement = await getProEntitlementStatus(supabase, userId);
      if (!entitlement.hasPro) {
        await setProfileTier(supabase, userId, 'free', null);
        downgradedUsers += 1;
      }
    }
  }

  return { verifiedPending, expiredGrants, downgradedUsers };
}
