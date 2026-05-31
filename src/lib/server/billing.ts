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
import {
  resolveSubscriptionCancellation,
  resolveSubscriptionResumption,
} from '@/lib/billing/subscription-cancel';
import {
  BillingApiError,
  assertBillingGatewayCapability,
  getBillingGatewayCapability,
} from '@/lib/server/billing-config';
import { firstEnv } from '@/lib/server/env';
import {
  coercePaymentMethodForGateway,
  getDefaultPaymentMethodForGateway,
  getSupportedPaymentMethodsForGateway,
  isPaymentMethodSupportedForGateway,
  type PaymentGatewayId,
  type PaymentVerifyResult,
} from '@/lib/payments/payment-gateway';
import {
  getPaymentGatewayById,
  resolvePaymentGateway,
} from '@/lib/payments/gateway-resolver';
import {
  PROMO_PRO_END_LAGOS_ISO,
  PROMO_PRO_END_UTC_ISO,
  isPromoModeActive,
} from '@/lib/server/promo-entitlements';
import {
  DEFAULT_BILLING_PLAN_CATALOG,
  type BillingPlanCatalogEntry,
  type MaterializedBillingPlanRow,
  materializeBillingPlanRow,
  resolveBillingPlanCatalogEntry,
  resolveBillingPlanKeyByAmount,
  resolveBillingPlanCode,
} from '@/lib/server/billing-plan-catalog';
import {
  buildRenewalRetryState,
  buildRenewalSuccessMetadata,
  classifyRenewalFailure,
} from '@/lib/server/billing-renewal';
import {
  disablePaystackSubscription,
  enablePaystackSubscription,
} from '@/lib/server/paystack';
import { loadPublicPlanCatalog } from '@/lib/server/au-limits';
import {
  buildCanonicalSubscriptionState,
  resolveCanonicalAccountPlanAuthority,
  serializeCanonicalPlanSummary,
} from '@/lib/server/account-plan-authority';
import { getEffectiveEntitlementsSnapshot } from '@/lib/server/effective-entitlements';
import { applyPlanTransition } from '@/lib/server/plan-sync';
import {
  PLATFORM_OWNER_USER_ID,
  isProtectedOwnerUserId,
} from '@/lib/admin/protected-owner';

export type BillingInterval = 'weekly' | 'monthly';
export type PaymentMethod = 'subscription' | 'transfer';

export type CheckoutResult = {
  authorizationUrl: string;
  reference: string;
};

type BillingPlanRow = MaterializedBillingPlanRow;

const PLAN_CATALOG: BillingPlanCatalogEntry[] = DEFAULT_BILLING_PLAN_CATALOG;

function entitlementDays(interval: BillingInterval): number {
  return interval === 'weekly' ? 7 : 30;
}

function normalizePaymentMethod(raw: unknown): PaymentMethod | null {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'subscription' || value === 'card' || value === 'auto_renew' || value === 'auto-renew') {
    return 'subscription';
  }
  if (value === 'transfer' || value === 'bank_transfer' || value === 'bank-transfer' || value === 'manual') {
    return 'transfer';
  }
  return null;
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

function resolvePaymentPlanKey(input: {
  planKeyRaw?: unknown;
  amountKobo?: unknown;
}): BillingPlanCatalogEntry['planKey'] | null {
  return (
    resolveBillingPlanCatalogEntry(input.planKeyRaw)?.planKey ||
    resolveBillingPlanKeyByAmount(input.amountKobo) ||
    null
  );
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
  const supportedPaymentMethods = getSupportedPaymentMethodsForGateway(input.gateway);
  const defaultPaymentMethod = getDefaultPaymentMethodForGateway(input.gateway);

  if (!input.billingEnabled) {
    return {
      enabled: false,
      gateway: input.gateway,
      code: 'billing_disabled',
      message: 'Billing is currently disabled.',
      supportedPaymentMethods,
      defaultPaymentMethod,
    };
  }

  if (input.promoActive) {
    return {
      enabled: false,
      gateway: input.gateway,
      code: 'promo_active',
      message: 'Checkout is unavailable while promo Pro access is active.',
      supportedPaymentMethods,
      defaultPaymentMethod,
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
      supportedPaymentMethods,
      defaultPaymentMethod,
    };
  }

  return {
    enabled: true,
    gateway: input.gateway,
    code: null,
    message: null,
    supportedPaymentMethods,
    defaultPaymentMethod,
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

function assertOwnerBillingMutationAllowed(userId: string) {
  if (!isProtectedOwnerUserId(userId)) return;
  throw new BillingApiError(
    403,
    'protected_owner_billing_disabled',
    'The protected owner test account uses admin entitlement overrides only. Billing mutations are disabled for this account.',
  );
}

async function webhookTargetsProtectedOwner(
  supabase: SupabaseClient,
  payload: any,
): Promise<boolean> {
  const data = payload?.data || {};
  const metadata = data?.metadata || payload?.metadata || {};
  const candidateUserIds = [
    metadata?.user_id,
    metadata?.userId,
    data?.user_id,
    data?.userId,
    payload?.user_id,
    payload?.userId,
  ];

  if (candidateUserIds.some(isProtectedOwnerUserId)) {
    return true;
  }

  const email = String(data?.customer?.email || payload?.customer?.email || '').trim().toLowerCase();
  if (!email) return false;
  const userId = await resolveUserIdFromEmail(supabase, email);
  return isProtectedOwnerUserId(userId);
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

function isGatewayAlreadyResumedError(error: unknown): boolean {
  const status = Number((error as any)?.status || 0);
  const message = String((error as any)?.message || '').trim().toLowerCase();
  if (status === 404) return true;
  if (status === 400 || status === 409 || status === 422) {
    return /(already enabled|already active|not disabled|subscription.*active|enabled already)/i.test(message);
  }
  return false;
}

const CANCELLATION_REASON_MIN_LENGTH = 10;
const CANCELLATION_REASON_MAX_LENGTH = 1000;

function normalizeCancellationReason(raw: unknown): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function persistCancellationFeedback(input: {
  supabase: SupabaseClient;
  userId: string;
  subscriptionId: number | null;
  planKey: string | null;
  subscriptionStatus: string | null;
  gateway: PaymentGatewayId;
  cancellationMode: string;
  cancellationReason: string;
  context?: Record<string, unknown>;
}) {
  const { supabase } = input;
  const { error } = await supabase.from('billing_cancellation_feedback').insert({
    user_id: input.userId,
    subscription_id: input.subscriptionId,
    plan_key: input.planKey,
    subscription_status: input.subscriptionStatus,
    gateway: input.gateway,
    cancellation_mode: input.cancellationMode,
    cancellation_reason: input.cancellationReason,
    context: input.context || {},
  });
  if (!error) return;
  const code = String((error as any)?.code || '');
  if (code === '42P01') {
    // Keep cancellation resilient when this optional table is not migrated yet.
    return;
  }
  throw error;
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
    .maybeSingle();
  if (error) {
    if (isSchemaDriftError(error)) return null;
    throw error;
  }
  return materializeBillingPlanRow({
    planKeyRaw: planKey,
    row: data
      ? {
          plan_key: (data as any).plan_key,
          interval: (data as any).interval,
          amount_kobo: (data as any).amount_kobo,
          paystack_plan_code: (data as any).paystack_plan_code,
          is_active: (data as any).is_active,
        }
      : null,
  });
}

async function resolveBillingPlan(
  supabase: SupabaseClient,
  planKeyRaw: unknown,
): Promise<BillingPlanRow | null> {
  const normalizedPlanKey = normalizePlanKey(planKeyRaw);
  if (!normalizedPlanKey) return null;
  const persisted = await loadBillingPlan(supabase, normalizedPlanKey);
  if (persisted) return persisted;
  return materializeBillingPlanRow({ planKeyRaw: normalizedPlanKey });
}

async function ensurePlanCatalog(supabase: SupabaseClient): Promise<void> {
  const planKeys = PLAN_CATALOG.map((plan) => plan.planKey);
  const { data: existingRows, error: existingError } = await supabase
    .from('billing_plans')
    .select('plan_key,paystack_plan_code')
    .in('plan_key', planKeys);
  if (existingError) {
    if (isSchemaDriftError(existingError)) return;
    throw existingError;
  }

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
      firstEnv(...plan.envCodes) ||
      existingCodes.get(plan.planKey) ||
      resolveBillingPlanCode(plan),
    is_active: true,
  }));
  const { error } = await supabase
    .from('billing_plans')
    .upsert(rows, { onConflict: 'plan_key' });
  if (error) {
    if (isSchemaDriftError(error)) return;
    throw error;
  }
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
  const updatedAt = new Date().toISOString();
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
      updated_at: updatedAt,
    },
    { onConflict: 'reference' }
  );
}

function isMissingRpcError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim();
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    code === '42883' ||
    (message.includes('function') && message.includes('does not exist')) ||
    (message.includes('schema cache') && message.includes('function'))
  );
}

function isSchemaDriftError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim();
  const message = String((error as any)?.message || '').toLowerCase();
  const details = String((error as any)?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('does not exist') ||
    details.includes('does not exist')
  );
}

async function recordRenewalAttemptFallback(input: {
  supabase: SupabaseClient;
  userId: string;
  planKey: string;
  gateway: PaymentGatewayId;
  reference: string | null;
  subscriptionCode: string | null;
  attemptNumber: number;
  failureKind: string;
  status: string;
  nextRetryAt: string | null;
  finalFailure: boolean;
  responseJson: Record<string, unknown>;
}) {
  const { error } = await input.supabase.from('billing_renewal_attempts').insert({
    user_id: input.userId,
    plan_key: input.planKey,
    gateway: input.gateway,
    reference: input.reference,
    subscription_code: input.subscriptionCode,
    attempt_number: input.attemptNumber,
    failure_kind: input.failureKind,
    status: input.status,
    next_retry_at: input.nextRetryAt,
    final_failure: input.finalFailure,
    response_json: input.responseJson,
  });

  if (error && !isSchemaDriftError(error)) {
    throw error;
  }
}

async function applyVerifiedPaymentEffects(input: {
  supabase: SupabaseClient;
  gateway: PaymentGatewayId;
  verified: PaymentVerifyResult;
  payload: any;
  idempotencyKey: string;
  traceId: string;
  reference: string;
  planKey: string | null;
  userId: string | null;
  customerEmail: string;
  transactionId: string;
  transactionMetadata: Record<string, unknown>;
}) {
  const {
    supabase,
    gateway,
    verified,
    payload,
    idempotencyKey,
    traceId,
    reference,
    planKey,
    userId,
    customerEmail,
    transactionId,
    transactionMetadata,
  } = input;

  if (
    isProtectedOwnerUserId(userId) ||
    isProtectedOwnerUserId(transactionMetadata.user_id) ||
    isProtectedOwnerUserId((payload?.data?.metadata || {}).user_id)
  ) {
    return;
  }

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

  if (!verified.success || !userId) {
    return;
  }
  if (!planKey) {
    throw new BillingApiError(
      422,
      'payment_plan_unresolvable',
      'Payment plan could not be resolved for this transaction.',
      {
        reference,
        requestedPlanKey: null,
        gateway,
      },
    );
  }

  const plan = await resolveBillingPlan(supabase, planKey);
  if (!plan || !plan.is_active) {
    throw new BillingApiError(
      422,
      'payment_plan_unresolvable',
      'Payment plan could not be resolved for this transaction.',
      {
        reference,
        requestedPlanKey: planKey || null,
        gateway,
      },
    );
  }

  const metadata = (verified.metadata || payload?.data?.metadata || {}) as Record<string, unknown>;
  const requestedChargeMethod = normalizePaymentMethod(metadata.payment_method) || 'subscription';
  const chargeMethod = coercePaymentMethodForGateway(gateway, requestedChargeMethod);
  const subscriptionMetadata = {
    latest_reference: reference,
    gateway,
    requested_payment_method: requestedChargeMethod,
    effective_payment_method: chargeMethod,
    transaction_id: transactionId,
    ...buildRenewalSuccessMetadata({
      reference,
      paidAt: verified.paidAt || null,
      gateway,
      gatewayResponse: verified.raw ?? payload,
    }),
  };

  try {
    const { error } = await supabase.rpc('apply_verified_billing_payment', {
      p_user_id: userId,
      p_reference: reference,
      p_amount_kobo: Number(verified.amountKobo || 0),
      p_channel: String(verified.channel || payload?.data?.channel || 'unknown'),
      p_status: verified.success ? 'success' : String(verified.status || 'pending'),
      p_paid_at: verified.paidAt || null,
      p_raw_event_json: payload,
      p_idempotency_key: idempotencyKey,
      p_metadata: {
        ...transactionMetadata,
        subscription_metadata: subscriptionMetadata,
      },
      p_gateway: gateway,
      p_plan_key: plan.plan_key,
      p_interval: plan.interval,
      p_charge_method: chargeMethod,
      p_transaction_id: transactionId,
      p_customer_email: customerEmail || null,
      p_customer_code: verified.customerCode || null,
      p_authorization_code: verified.authorizationCode || null,
      p_subscription_code: verified.subscriptionCode || null,
      p_subscription_email_token: verified.subscriptionEmailToken || null,
      p_trace_id: traceId,
      p_transition_kind: chargeMethod === 'transfer' ? 'upgrade' : 'renewal',
    });
    if (!error) {
      return;
    }
    if (!isMissingRpcError(error)) {
      throw error;
    }
  } catch (error) {
    if (!isMissingRpcError(error)) {
      throw error;
    }
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
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

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
      requested_payment_method: requestedChargeMethod,
      effective_payment_method: chargeMethod,
    },
  });

  try {
    await applyPlanTransition(supabase, {
      userId,
      targetPlan: 'pro',
      entitlementSource: 'paid',
      entitlementEndsAt: grant.endsAt,
      transitionKind: chargeMethod === 'transfer' ? 'upgrade' : 'renewal',
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
            metadata: subscriptionMetadata,
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

async function applyRenewalFailureEffects(input: {
  supabase: SupabaseClient;
  userId: string;
  gateway: PaymentGatewayId;
  planKey: string;
  subscriptionCode: string | null;
  reference: string | null;
  amountKobo: number;
  channel: string;
  retryState: ReturnType<typeof buildRenewalRetryState>;
  responseJson: Record<string, unknown>;
  traceId: string;
  currentMetadata: Record<string, unknown>;
  currentEndsAt: string | null;
}) {
  if (isProtectedOwnerUserId(input.userId)) {
    return;
  }

  const nowIso = new Date().toISOString();
  const nextMetadata = {
    ...input.currentMetadata,
    renewal_attempt_count: input.retryState.attemptNumber,
    renewal_failure_kind: input.retryState.failureKind,
    renewal_last_failed_at: nowIso,
    renewal_next_retry_at: input.retryState.nextRetryAt,
    renewal_final_failure: input.retryState.finalFailure,
    renewal_status: input.retryState.status,
    renewal_last_gateway_response: input.responseJson,
  };

  try {
    const { error } = await input.supabase.rpc('apply_billing_renewal_failure', {
      p_user_id: input.userId,
      p_reference: input.reference,
      p_gateway: input.gateway,
      p_plan_key: input.planKey,
      p_subscription_code: input.subscriptionCode,
      p_attempt_number: input.retryState.attemptNumber,
      p_failure_kind: input.retryState.failureKind,
      p_next_retry_at: input.retryState.nextRetryAt,
      p_final_failure: input.retryState.finalFailure,
      p_response_json: input.responseJson,
      p_amount_kobo: input.amountKobo,
      p_channel: input.channel,
      p_trace_id: input.traceId,
    });
    if (!error) {
      return;
    }
    if (!isMissingRpcError(error)) {
      throw error;
    }
  } catch (error) {
    if (!isMissingRpcError(error)) {
      throw error;
    }
  }

  if (input.reference) {
    await markTransaction({
      supabase: input.supabase,
      userId: input.userId,
      reference: input.reference,
      amountKobo: input.amountKobo,
      channel: input.channel,
      status: 'failed',
      rawEventJson: input.responseJson,
      idempotencyKey: `renewal-failed:${input.reference}:${input.retryState.attemptNumber}`,
      metadata: {
        gateway: input.gateway,
        plan_key: input.planKey,
        subscription_code: input.subscriptionCode,
      },
    });
  }

  await recordRenewalAttemptFallback({
    supabase: input.supabase,
    userId: input.userId,
    planKey: input.planKey,
    gateway: input.gateway,
    reference: input.reference,
    subscriptionCode: input.subscriptionCode,
    attemptNumber: input.retryState.attemptNumber,
    failureKind: input.retryState.failureKind,
    status: input.retryState.status,
    nextRetryAt: input.retryState.nextRetryAt,
    finalFailure: input.retryState.finalFailure,
    responseJson: input.responseJson,
  });

  await input.supabase.from('billing_subscriptions').upsert(
    {
      user_id: input.userId,
      plan_key: input.planKey,
      status: 'expired',
      paystack_subscription_code: input.subscriptionCode || null,
      ends_at: nowIso,
      cancel_at_period_end: true,
      metadata: nextMetadata,
      updated_at: nowIso,
    },
    { onConflict: 'user_id' }
  );

  await input.supabase
    .from('entitlement_grants')
    .update({ status: 'expired', ends_at: nowIso })
    .eq('user_id', input.userId)
    .eq('entitlement', 'pro')
    .eq('status', 'active');

  await applyPlanTransition(input.supabase, {
    userId: input.userId,
    targetPlan: 'free',
    entitlementSource: 'none',
    entitlementEndsAt: null,
    transitionKind: 'downgrade',
    source: 'billing_renewal',
    reason: 'final_renewal_failure',
    traceId: input.traceId,
    metadata: {
      gateway: input.gateway,
      plan_key: input.planKey,
      reference: input.reference,
      failure_kind: input.retryState.failureKind,
    },
    subscription: {
      planKey: input.planKey,
      status: 'expired',
      paystackSubscriptionCode: input.subscriptionCode || null,
      endsAt: nowIso,
      cancelAtPeriodEnd: true,
      metadata: nextMetadata,
    },
  });
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
  assertOwnerBillingMutationAllowed(userId);
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
  if (!paymentMethod) {
    throw new BillingApiError(400, 'invalid_payment_method', 'Payment method must be subscription or transfer.');
  }
  const gateway = resolvePaymentGateway();
  if (!isPaymentMethodSupportedForGateway(gateway.gateway, paymentMethod)) {
    throw new BillingApiError(
      409,
      'payment_method_not_supported',
      `${gateway.gateway} does not support ${paymentMethod} billing for this checkout.`,
      {
        gateway: gateway.gateway,
        paymentMethod,
      },
    );
  }
  const plan = await resolveBillingPlan(supabase, planKey);
  if (!plan || !plan.is_active) {
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

  const initPayload = {
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
  };

  let response;
  try {
    response = await gateway.initializePayment(initPayload);
  } catch (error: any) {
    const msg = String(error?.message || '').toLowerCase();
    if (initPayload.planCode && (msg.includes('plan') || msg.includes('not found') || msg.includes('invalid'))) {
      console.warn(`[billing] Paystack rejected plan code ${initPayload.planCode}. Falling back to one-time charge.`);
      initPayload.planCode = null;
      response = await gateway.initializePayment(initPayload);
    } else {
      throw error;
    }
  }
  const checkoutReference = String(response.reference || reference);

  await supabase.from('billing_customers').upsert(
    {
      user_id: userId,
      email: email.toLowerCase(),
      metadata: {},
      updated_at: new Date().toISOString(),
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
  assertOwnerBillingMutationAllowed(input.userId);

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

  const planKeyRaw = asTrimmedString(verifiedMetadata.plan_key);
  const plan = await resolveBillingPlan(input.supabase, planKeyRaw || '');
  if (plan && verifiedResult.verified.amountKobo !== plan.amount_kobo) {
    throw new BillingApiError(
      409,
      'payment_amount_mismatch',
      'Verified payment amount does not match the required plan amount.'
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

  const authority = await resolveCanonicalAccountPlanAuthority({
    supabase,
    userId,
  });
  const effectiveEntitlements = authority.entitlements;
  const { data: profileRow } = await supabase
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', userId)
    .maybeSingle();
  const profileTierRaw = (profileRow as any)?.tier;
  const currentTier = normalizeEffectiveEntitlementPlan(profileTierRaw);
  const isOwnerTestAccount = isProtectedOwnerUserId(userId);

  if (!isOwnerTestAccount && currentTier !== 'admin' && effectiveEntitlements.plan !== 'admin') {
    await applyPlanTransition(supabase, {
      userId,
      targetPlan: authority.effectivePlan.plan,
      entitlementSource: authority.effectivePlan.entitlementSource,
      entitlementEndsAt: authority.effectivePlan.expiresAt,
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

  let currentSubscription = subscriptions?.[0] || null;
  const subscriptionStatus = String(currentSubscription?.status || '').trim().toLowerCase();
  const subscriptionEndsAtMs = new Date(String(currentSubscription?.ends_at || '')).getTime();
  const shouldMarkSubscriptionExpired =
    !!currentSubscription &&
    Number.isFinite(subscriptionEndsAtMs) &&
    subscriptionEndsAtMs <= Date.now() &&
    (subscriptionStatus === 'active' || subscriptionStatus === 'trialing' || subscriptionStatus === 'non_renewing');

  if (shouldMarkSubscriptionExpired && !isOwnerTestAccount) {
    const updatedAt = new Date().toISOString();
    const { error: expireError } = await supabase
      .from('billing_subscriptions')
      .update({
        status: 'expired',
        cancel_at_period_end: true,
        updated_at: updatedAt,
      })
      .eq('user_id', userId);
    if (!expireError) {
      currentSubscription = {
        ...(currentSubscription as any),
        status: 'expired',
        cancel_at_period_end: true,
        updated_at: updatedAt,
      } as any;
    }
  }

  const currentPlan = buildCanonicalSubscriptionState({
    authority,
    profileTier: profileTierRaw ?? currentTier,
    subscriptionPlanKey: currentSubscription?.plan_key,
    subscriptionStatus: currentSubscription?.status,
    latestPaymentPlanKey: resolveLatestTransactionPlanKey(txs || []),
  });
  const gateway = resolvePaymentGateway();
  const checkoutCapability = buildCheckoutCapability({
    billingEnabled: effectiveEntitlements.billingEnabled,
    promoActive: effectiveEntitlements.promoActive,
    gateway: gateway.gateway,
  });
  const checkout = isOwnerTestAccount
    ? {
        ...checkoutCapability,
        enabled: false,
        code: 'protected_owner_billing_disabled',
        message: 'The protected owner test account uses admin entitlement overrides instead of checkout.',
      }
    : checkoutCapability;
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
  const account = serializeCanonicalPlanSummary({
    authority,
    currentPlan,
  });

  return {
    billingEnabled: effectiveEntitlements.billingEnabled,
    promoEnabled: effectiveEntitlements.promoEnabled,
    canAccessBilling: effectiveEntitlements.canAccessBilling,
    tier: currentPlan.managedPlan,
    effectivePlan: authority.effectivePlan.plan,
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
    account,
    accountSource: authority.effectivePlan.source,
    validatedAt: authority.validatedAt,
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
  assertOwnerBillingMutationAllowed(userId);

  const cancellationReason = normalizeCancellationReason(options?.reason);
  if (cancellationReason.length < CANCELLATION_REASON_MIN_LENGTH) {
    throw new BillingApiError(
      400,
      'invalid_cancellation_reason',
      `Cancellation reason must be at least ${CANCELLATION_REASON_MIN_LENGTH} characters.`
    );
  }
  if (cancellationReason.length > CANCELLATION_REASON_MAX_LENGTH) {
    throw new BillingApiError(
      400,
      'invalid_cancellation_reason',
      `Cancellation reason must be ${CANCELLATION_REASON_MAX_LENGTH} characters or fewer.`
    );
  }

  const { data: subscription, error } = await supabase
    .from('billing_subscriptions')
    .select('id,plan_key,paystack_subscription_code,paystack_email_token,status,metadata,cancel_at_period_end,ends_at')
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
    cancel_reason: cancellationReason,
    cancel_reason_length: cancellationReason.length,
    gateway_cancel_mode: resolution.mode,
    gateway_cancel_reason: resolution.reason,
  };

  const { error: updateError } = await supabase
    .from('billing_subscriptions')
    .update({
      status: 'non_renewing',
      cancel_at_period_end: true,
      metadata: nextMetadata,
      updated_at: canceledAt,
    })
    .eq('user_id', userId);
  if (updateError) throw updateError;

  const subscriptionIdRaw = Number((subscription as any)?.id);
  await persistCancellationFeedback({
    supabase,
    userId,
    subscriptionId: Number.isFinite(subscriptionIdRaw) ? subscriptionIdRaw : null,
    planKey: asTrimmedString((subscription as any)?.plan_key) || null,
    subscriptionStatus: asTrimmedString((subscription as any)?.status) || null,
    gateway,
    cancellationMode: resolution.mode,
    cancellationReason,
    context: {
      gateway_cancel_reason: resolution.reason,
      ends_at: (subscription as any)?.ends_at || null,
    },
  });

  void writeEntitlementAudit(supabase, {
    userId,
    action: 'subscription_cancel_requested',
    before: {
      status: (subscription as any)?.status || null,
      cancel_at_period_end: (subscription as any)?.cancel_at_period_end === true,
    },
    after: {
      status: 'non_renewing',
      cancel_at_period_end: true,
    },
    source: 'billing_cancel',
    traceId: `cancel-${userId}-${Date.now()}`,
  }).catch(() => undefined);

  return {
    outcome: 'scheduled',
    message: 'Auto-renew has been turned off for this subscription.',
  };
}

export async function resumeUserSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  outcome: 'resumed' | 'already_renewing' | 'not_resumable' | 'no_subscription';
  message: string;
}> {
  assertOwnerBillingMutationAllowed(userId);

  const { data: subscription, error } = await supabase
    .from('billing_subscriptions')
    .select('id,plan_key,paystack_subscription_code,paystack_email_token,status,metadata,cancel_at_period_end')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!subscription) {
    return {
      outcome: 'no_subscription',
      message: 'No subscription was found for this account.',
    };
  }

  const code = String((subscription as any).paystack_subscription_code || '').trim();
  const token = String((subscription as any).paystack_email_token || '').trim();
  const metadata = ((subscription as any)?.metadata || {}) as Record<string, unknown>;
  const gateway = resolveGatewayFromMetadata(metadata);
  const resolution = resolveSubscriptionResumption({
    status: (subscription as any)?.status,
    cancelAtPeriodEnd: (subscription as any)?.cancel_at_period_end === true,
    gateway,
    paystackSubscriptionCode: code,
    paystackEmailToken: token,
  });

  if (resolution.mode === 'noop') {
    if (resolution.reason === 'already_renewing') {
      return {
        outcome: 'already_renewing',
        message: 'Auto-renew is already active for this subscription.',
      };
    }
    if (resolution.reason === 'already_stopped') {
      return {
        outcome: 'not_resumable',
        message: 'This subscription has already ended. Please start a new checkout to subscribe again.',
      };
    }
    return {
      outcome: 'no_subscription',
      message: 'No subscription was found for this account.',
    };
  }

  if (resolution.mode === 'remote_resume') {
    try {
      await enablePaystackSubscription({ code, token });
    } catch (error) {
      if (!isGatewayAlreadyResumedError(error)) {
        throw new BillingApiError(
          502,
          'subscription_resume_failed',
          'The billing provider could not restore auto-renew right now.'
        );
      }
    }
  }

  const resumedAt = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    resumed_at: resumedAt,
    resumed_by: 'user',
    gateway_resume_mode: resolution.mode,
    gateway_resume_reason: resolution.reason,
  };

  const { error: updateError } = await supabase
    .from('billing_subscriptions')
    .update({
      status: 'active',
      cancel_at_period_end: false,
      metadata: nextMetadata,
      updated_at: resumedAt,
    })
    .eq('user_id', userId);
  if (updateError) throw updateError;

  void writeEntitlementAudit(supabase, {
    userId,
    action: 'subscription_resume_requested',
    before: {
      status: (subscription as any)?.status || null,
      cancel_at_period_end: (subscription as any)?.cancel_at_period_end === true,
    },
    after: {
      status: 'active',
      cancel_at_period_end: false,
    },
    source: 'billing_resume',
    traceId: `resume-${userId}-${Date.now()}`,
  }).catch(() => undefined);

  return {
    outcome: 'resumed',
    message: 'Auto-renew has been restored for your subscription.',
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
  const planKey = resolvePaymentPlanKey({
    planKeyRaw: metadata.plan_key,
    amountKobo: verified.amountKobo,
  });
  const userIdFromMetadata = String(metadata.user_id || '').trim();
  const customerEmail = String(verified.customerEmail || '').trim().toLowerCase();
  const userIdFromCustomer = await resolveUserIdFromEmail(supabase, customerEmail);
  const userId = userIdFromMetadata || userIdFromCustomer || null;
  if (isProtectedOwnerUserId(userId)) {
    return;
  }
  const transactionId = String(verified.gatewayTransactionId || reference);
  const requestedPaymentMethod = normalizePaymentMethod(metadata.payment_method) || 'subscription';
  const effectivePaymentMethod = coercePaymentMethodForGateway(gateway, requestedPaymentMethod);

  const transactionMetadata: Record<string, unknown> = {
    ...metadata,
    plan_key: planKey || null,
    gateway,
    requested_payment_method: requestedPaymentMethod,
    effective_payment_method: effectivePaymentMethod,
    gateway_transaction_id: transactionId,
    authorization_code: verified.authorizationCode || null,
    customer_code: verified.customerCode || null,
    subscription_code: verified.subscriptionCode || null,
    subscription_email_token: verified.subscriptionEmailToken || null,
  };

  await applyVerifiedPaymentEffects({
    supabase,
    gateway,
    verified,
    payload,
    idempotencyKey,
    traceId,
    reference,
    planKey,
    userId,
    customerEmail,
    transactionId,
    transactionMetadata,
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
  const metadataUserId = String(payload?.data?.metadata?.user_id || '').trim();
  const userId = metadataUserId || (await resolveUserIdFromEmail(supabase, email));

  if (!reference) return;
  if (isProtectedOwnerUserId(userId)) return;

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
  if (isProtectedOwnerUserId(userId)) return;

  const { data: existingSubscription, error: existingSubscriptionError } = await supabase
    .from('billing_subscriptions')
    .select('plan_key,metadata,ends_at,paystack_subscription_code,paystack_email_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (existingSubscriptionError) throw existingSubscriptionError;

  const existingMetadata = (((existingSubscription as any)?.metadata || {}) as Record<string, unknown>) || {};
  const subscriptionCode = String(data?.subscription_code || data?.code || '').trim();
  const emailToken = String(data?.email_token || '').trim();
  const planKey =
    resolvePaymentPlanKey({
      planKeyRaw:
        data?.plan?.name ||
        data?.metadata?.plan_key ||
        (existingSubscription as any)?.plan_key ||
        null,
      amountKobo: Number(data?.amount || 0),
    }) || 'pro_monthly';

  if (eventType === 'invoice.payment_failed') {
    const retryState = buildRenewalRetryState({
      existingAttemptCount: Number((existingMetadata as any)?.renewal_attempt_count || 0),
      failureKind: classifyRenewalFailure({
        gatewayResponse: data?.gateway_response,
        message: data?.message,
        status: data?.status,
      }),
    });

    await applyRenewalFailureEffects({
      supabase,
      userId,
      gateway: 'paystack',
      planKey,
      subscriptionCode: subscriptionCode || String((existingSubscription as any)?.paystack_subscription_code || '').trim() || null,
      reference: String(data?.reference || '').trim() || null,
      amountKobo: Number(data?.amount || 0),
      channel: String(data?.channel || 'subscription'),
      retryState,
      responseJson: {
        event: eventType,
        data,
      },
      traceId,
      currentMetadata: existingMetadata,
      currentEndsAt:
        typeof (existingSubscription as any)?.ends_at === 'string'
          ? String((existingSubscription as any).ends_at)
          : null,
    });
    return;
  }

  let status = 'active';
  let cancelAtPeriodEnd = false;
  if (eventType === 'subscription.disable') {
    status = 'canceled';
    cancelAtPeriodEnd = true;
  } else if (eventType === 'subscription.not_renew') {
    status = 'non_renewing';
    cancelAtPeriodEnd = true;
  }

  await supabase.from('billing_subscriptions').upsert(
    {
      user_id: userId,
      plan_key: planKey,
      status,
      paystack_subscription_code: subscriptionCode || null,
      paystack_email_token: emailToken || null,
      cancel_at_period_end: cancelAtPeriodEnd,
      metadata: {
        ...existingMetadata,
        ...data,
        gateway: 'paystack',
      },
      updated_at: new Date().toISOString(),
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
  if (await webhookTargetsProtectedOwner(supabase, payload)) {
    return { duplicate: false, event };
  }

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
  if (await webhookTargetsProtectedOwner(supabase, normalizedPayload)) {
    return { duplicate: false, event };
  }

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
    .select('reference,user_id,metadata')
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
      if (isProtectedOwnerUserId((row as any).user_id) || isProtectedOwnerUserId(metadata.user_id)) {
        continue;
      }
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
    .neq('user_id', PLATFORM_OWNER_USER_ID)
    .lt('ends_at', nowIso)
    .select('user_id');
  if (expiredErr) throw expiredErr;
  const expiredGrants = expiredRows?.length || 0;

  await supabase
    .from('billing_subscriptions')
    .update({ status: 'expired', updated_at: nowIso })
    .in('status', ['active', 'non_renewing'])
    .eq('cancel_at_period_end', true)
    .neq('user_id', PLATFORM_OWNER_USER_ID)
    .lt('ends_at', nowIso);

  let downgradedUsers = 0;
  const promoModeActive = await isPromoModeActive(supabase);
  if (!promoModeActive) {
    const { data: proProfiles, error: profileErr } = await supabase
      .from('au_user_profiles')
      .select('user_id')
      .eq('tier', 'pro')
      .neq('user_id', PLATFORM_OWNER_USER_ID);
    if (profileErr) throw profileErr;

    for (const row of proProfiles || []) {
      const userId = String((row as any).user_id || '').trim();
      if (!userId) continue;
      if (isProtectedOwnerUserId(userId)) continue;
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
