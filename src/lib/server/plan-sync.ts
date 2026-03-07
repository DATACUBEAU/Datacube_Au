import { randomUUID } from 'crypto';
import {
  normalizeEntitlementSource,
  normalizeManagedPlan,
  resolvePlanExpirationDays,
  resolvePlanTransitionKind,
  type EntitlementSource,
  type ManagedPlanCode,
  type PlanTransitionKind,
} from '../plans/subscription-policy';

type SupabaseLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
};

export type PlanTransitionSubscriptionInput = {
  planKey?: string | null;
  status?: string | null;
  paystackSubscriptionCode?: string | null;
  paystackEmailToken?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, unknown>;
};

export type PlanTransitionInput = {
  userId: string;
  targetPlan: string;
  entitlementSource?: string | null;
  entitlementEndsAt?: string | null;
  transitionKind?: PlanTransitionKind;
  source: string;
  reason?: string | null;
  traceId?: string | null;
  metadata?: Record<string, unknown>;
  subscription?: PlanTransitionSubscriptionInput | null;
};

export type PlanTransitionResult = {
  changed: boolean;
  plan: ManagedPlanCode;
  entitlementSource: EntitlementSource;
  expiresAt: string | null;
  transitionKind: PlanTransitionKind;
  documentsUpdated: number;
  traceId: string;
};

const transitionQueue = new Map<string, Promise<PlanTransitionResult>>();

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isMissingRpcError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42883' ||
    (message.includes('function') && message.includes('does not exist')) ||
    (message.includes('schema cache') && message.includes('function'))
  );
}

function normalizeSubscription(input: PlanTransitionSubscriptionInput | null | undefined): Record<string, unknown> {
  if (!input) return {};
  return {
    plan_key: input.planKey ?? null,
    status: input.status ?? null,
    paystack_subscription_code: input.paystackSubscriptionCode ?? null,
    paystack_email_token: input.paystackEmailToken ?? null,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    cancel_at_period_end: input.cancelAtPeriodEnd === true,
    metadata: input.metadata || {},
  };
}

async function applyFallbackPlanTransition(
  supabase: SupabaseLike,
  input: Required<Pick<PlanTransitionInput, 'userId' | 'source'>> &
    Omit<PlanTransitionInput, 'userId' | 'source'> & {
      traceId: string;
      normalizedPlan: ManagedPlanCode;
      normalizedEntitlementSource: EntitlementSource;
      normalizedTransitionKind: PlanTransitionKind;
    },
): Promise<PlanTransitionResult> {
  const tier = input.normalizedPlan === 'free' ? 'free' : input.normalizedPlan;
  const expiresAt = input.entitlementEndsAt ?? null;
  const entitlementMetadata = {
    ...(input.metadata || {}),
    last_transition_source: input.source,
    last_transition_reason: input.reason || null,
    last_transition_trace_id: input.traceId,
    current_expiration_days: resolvePlanExpirationDays({
      plan: input.normalizedPlan,
      entitlementSource: input.normalizedEntitlementSource,
    }),
  };

  const entitlementWrite = await supabase
    .from('au_user_entitlements')
    .upsert(
      {
        user_id: input.userId,
        plan: input.normalizedPlan,
        source: input.normalizedEntitlementSource,
        expires_at: expiresAt,
        metadata: entitlementMetadata,
      },
      { onConflict: 'user_id' },
    );
  if (entitlementWrite.error) throw entitlementWrite.error;

  const profileWrite = await supabase
    .from('au_user_profiles')
    .upsert(
      {
        user_id: input.userId,
        tier,
        tier_expires_at: expiresAt,
      },
      { onConflict: 'user_id' },
    );
  if (profileWrite.error) throw profileWrite.error;

  const subscription = normalizeSubscription(input.subscription);
  if (Object.keys(subscription).length > 0) {
    const subscriptionWrite = await supabase
      .from('billing_subscriptions')
      .upsert(
        {
          user_id: input.userId,
          ...subscription,
        },
        { onConflict: 'user_id' },
      );
    if (subscriptionWrite.error) throw subscriptionWrite.error;
  }

  const auditWrite = await supabase.from('entitlement_audit').insert({
    user_id: input.userId,
    action: `plan_transition:${input.normalizedTransitionKind}`,
    before_json: null,
    after_json: {
      plan: input.normalizedPlan,
      entitlement_source: input.normalizedEntitlementSource,
      expires_at: expiresAt,
    },
    source: input.source,
    trace_id: input.traceId,
  });
  if (auditWrite.error) throw auditWrite.error;

  return {
    changed: true,
    plan: input.normalizedPlan,
    entitlementSource: input.normalizedEntitlementSource,
    expiresAt,
    transitionKind: input.normalizedTransitionKind,
    documentsUpdated: 0,
    traceId: input.traceId,
  };
}

async function runPlanTransition(
  supabase: SupabaseLike,
  input: PlanTransitionInput,
): Promise<PlanTransitionResult> {
  const normalizedPlan = normalizeManagedPlan(input.targetPlan);
  const normalizedEntitlementSource = normalizeEntitlementSource(input.entitlementSource);
  const traceId = String(input.traceId || randomUUID());
  const normalizedTransitionKind =
    input.transitionKind ||
    resolvePlanTransitionKind({
      previousPlan: null,
      previousEntitlementSource: null,
      nextPlan: normalizedPlan,
      nextEntitlementSource: normalizedEntitlementSource,
    });

  const rpcPayload = {
    p_user_id: input.userId,
    p_target_plan: normalizedPlan,
    p_entitlement_source: normalizedEntitlementSource,
    p_entitlement_expires_at: input.entitlementEndsAt ?? null,
    p_transition_kind: normalizedTransitionKind,
    p_transition_source: input.source,
    p_reason: input.reason ?? null,
    p_trace_id: traceId,
    p_metadata: input.metadata || {},
    p_subscription: normalizeSubscription(input.subscription),
  };

  const { data, error } = await supabase.rpc('apply_plan_transition', rpcPayload);
  if (error) {
    if (isMissingRpcError(error)) {
      return applyFallbackPlanTransition(supabase, {
        ...input,
        traceId,
        normalizedPlan,
        normalizedEntitlementSource,
        normalizedTransitionKind,
      });
    }
    throw error;
  }

  const row = asRecord(data);
  return {
    changed: row.changed !== false,
    plan: normalizeManagedPlan(String(row.plan || normalizedPlan)),
    entitlementSource: normalizeEntitlementSource(String(row.entitlement_source || normalizedEntitlementSource)),
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : (input.entitlementEndsAt ?? null),
    transitionKind: resolvePlanTransitionKind({
      previousPlan: String(row.previous_plan || ''),
      previousEntitlementSource: String(row.previous_entitlement_source || ''),
      nextPlan: String(row.plan || normalizedPlan),
      nextEntitlementSource: String(row.entitlement_source || normalizedEntitlementSource),
    }),
    documentsUpdated: Number(row.documents_updated || 0),
    traceId,
  };
}

export async function applyPlanTransition(
  supabase: SupabaseLike,
  input: PlanTransitionInput,
): Promise<PlanTransitionResult> {
  const previous = transitionQueue.get(input.userId) || Promise.resolve({
    changed: false,
    plan: normalizeManagedPlan(input.targetPlan),
    entitlementSource: normalizeEntitlementSource(input.entitlementSource),
    expiresAt: input.entitlementEndsAt ?? null,
    transitionKind: input.transitionKind || 'sync',
    documentsUpdated: 0,
    traceId: String(input.traceId || ''),
  } satisfies PlanTransitionResult);

  const next = previous
    .catch(() => undefined as unknown)
    .then(() => runPlanTransition(supabase, input));

  transitionQueue.set(input.userId, next);

  try {
    return await next;
  } finally {
    if (transitionQueue.get(input.userId) === next) {
      transitionQueue.delete(input.userId);
    }
  }
}
