import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCanonicalBillingPlanKey } from '@/lib/billing/plans';
import {
  type NormalizedSubscriptionState,
} from '@/lib/billing/subscription-state';
import {
  buildBillingPlanSnapshot,
  type BillingPlanSnapshot,
} from '@/lib/server/billing-session';
import {
  buildCanonicalSubscriptionState,
  type CanonicalAccountPlanAuthority,
  resolveCanonicalAccountPlanAuthority,
} from '@/lib/server/account-plan-authority';

type BillingSubscriptionSummary = {
  planKey: string | null;
  status: string | null;
  startsAt: string | null;
  endsAt: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string | null;
};

export type CanonicalAccountSnapshot = {
  userId: string;
  validatedAt: string;
  plan: CanonicalAccountPlanAuthority['limits']['plan'];
  effectivePlan: CanonicalAccountPlanAuthority['effectivePlan'];
  entitlements: CanonicalAccountPlanAuthority['entitlements'];
  currentPlan: NormalizedSubscriptionState;
  planSnapshot: BillingPlanSnapshot;
  limits: CanonicalAccountPlanAuthority['limits']['limits'];
  limitRules: CanonicalAccountPlanAuthority['limits']['limitRules'];
  usage: {
    today: CanonicalAccountPlanAuthority['limits']['usage']['today'];
    total: CanonicalAccountPlanAuthority['limits']['usage']['total'];
    byLimit: CanonicalAccountPlanAuthority['limits']['usage']['by_limit'];
    windows: CanonicalAccountPlanAuthority['limits']['usage']['windows'];
    resetPolicies: CanonicalAccountPlanAuthority['limits']['usage']['reset_policies'];
    resetAt: CanonicalAccountPlanAuthority['limits']['usage']['reset_at'];
  };
  subscription: BillingSubscriptionSummary | null;
};

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
      const metadata = (((row as any)?.metadata || {}) as Record<string, unknown>) || {};
      const planKey = normalizePlanKey(metadata.plan_key);
      if (planKey) return planKey;
    }
  }
  return null;
}

function toSubscriptionSummary(row: any): BillingSubscriptionSummary | null {
  if (!row || typeof row !== 'object') return null;
  return {
    planKey: typeof row.plan_key === 'string' && row.plan_key.trim() ? row.plan_key : null,
    status: typeof row.status === 'string' && row.status.trim() ? row.status : null,
    startsAt: typeof row.starts_at === 'string' && row.starts_at.trim() ? row.starts_at : null,
    endsAt: typeof row.ends_at === 'string' && row.ends_at.trim() ? row.ends_at : null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    updatedAt: typeof row.updated_at === 'string' && row.updated_at.trim() ? row.updated_at : null,
  };
}

export async function resolveCanonicalAccountSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<CanonicalAccountSnapshot> {
  const [
    authority,
    profileRes,
    subscriptionsRes,
    txsRes,
  ] = await Promise.all([
    resolveCanonicalAccountPlanAuthority({
      supabase,
      userId,
    }),
    supabase.from('au_user_profiles').select('tier').eq('user_id', userId).maybeSingle(),
    supabase
      .from('billing_subscriptions')
      .select('plan_key,status,starts_at,ends_at,cancel_at_period_end,updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('billing_transactions')
      .select('status,metadata')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (subscriptionsRes.error) throw subscriptionsRes.error;
  if (txsRes.error) throw txsRes.error;

  const currentSubscription = subscriptionsRes.data?.[0] || null;
  const latestPaymentPlanKey = resolveLatestTransactionPlanKey(txsRes.data || []);
  const profileTierRaw = (profileRes.data as any)?.tier ?? null;
  const currentPlan = buildCanonicalSubscriptionState({
    authority,
    profileTier: profileTierRaw ?? authority.effectivePlan.plan,
    subscriptionPlanKey: currentSubscription?.plan_key,
    subscriptionStatus: currentSubscription?.status,
    latestPaymentPlanKey,
  });

  const planSnapshot = buildBillingPlanSnapshot({
    userId,
    status: {
      tier: currentPlan.managedPlan,
      entitlementSource: authority.entitlements.entitlementSource,
      tier_expires_at: authority.entitlements.entitlementEndsAt,
      currentPlan,
    },
  });

  return {
    userId,
    validatedAt: authority.validatedAt,
    plan: authority.limits.plan,
    effectivePlan: authority.effectivePlan,
    entitlements: authority.entitlements,
    currentPlan,
    planSnapshot,
    limits: authority.limits.limits,
    limitRules: authority.limits.limitRules,
    usage: {
      today: authority.limits.usage.today,
      total: authority.limits.usage.total,
      byLimit: authority.limits.usage.by_limit,
      windows: authority.limits.usage.windows,
      resetPolicies: authority.limits.usage.reset_policies,
      resetAt: authority.limits.usage.reset_at,
    },
    subscription: toSubscriptionSummary(currentSubscription),
  };
}
