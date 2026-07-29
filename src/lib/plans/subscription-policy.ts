const DAY_MS = 24 * 60 * 60 * 1000;

export const SIGNED_OUT_DOCUMENT_CLEANUP_DAYS = 7;
export const FREE_PLAN_EXPIRATION_DAYS = 14;
export const PROMO_PLAN_EXPIRATION_DAYS = 14;
export const PAID_PRO_PLAN_EXPIRATION_DAYS = 30;
export const PREMIUM_PLAN_EXPIRATION_DAYS = 30;

export const TOKEN_LIMITS_BY_PLAN = {
  free: 4_000,
  pro: 18_000,
  premium: 45_000,
} as const;

export type ManagedPlanCode = 'free' | 'pro' | 'premium';
export type EntitlementSource = 'paid' | 'promo' | 'none';
export type PlanTransitionKind = 'upgrade' | 'downgrade' | 'renewal' | 'sync';

export type PlanExpirationInput = {
  plan?: string | null | undefined;
  entitlementSource?: string | null | undefined;
};

export function computeUtcQuotaWindowBounds(resetEveryDays: number, now = new Date()): { start: string; end: string | null } {
  const safeDays = Math.floor(Number(resetEveryDays) || 0);
  if (safeDays <= 0) {
    return {
      start: '1970-01-01T00:00:00.000Z',
      end: null,
    };
  }

  const utcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const epochDay = Math.floor(utcMidnightMs / DAY_MS);
  const windowStartDay = epochDay - (epochDay % safeDays);
  const startMs = windowStartDay * DAY_MS;
  const endMs = startMs + safeDays * DAY_MS;

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

export function normalizeManagedPlan(plan: string | null | undefined): ManagedPlanCode {
  const value = String(plan || '').trim().toLowerCase();
  if (value === 'premium') return 'premium';
  if (value === 'pro' || value === 'promo_pro' || value === 'admin' || value === 'weekly' || value === 'monthly' || value === 'paid') {
    return 'pro';
  }
  return 'free';
}

export function normalizeEntitlementSource(source: string | null | undefined): EntitlementSource {
  const value = String(source || '').trim().toLowerCase();
  if (value === 'paid') return 'paid';
  if (value === 'promo') return 'promo';
  return 'none';
}

export function resolvePlanExpirationDays(input: PlanExpirationInput): number {
  const entitlementSource = normalizeEntitlementSource(input.entitlementSource);
  if (entitlementSource === 'promo') {
    return PROMO_PLAN_EXPIRATION_DAYS;
  }

  const plan = normalizeManagedPlan(input.plan);
  if (plan === 'premium') return PREMIUM_PLAN_EXPIRATION_DAYS;
  if (plan === 'pro') return PAID_PRO_PLAN_EXPIRATION_DAYS;
  return FREE_PLAN_EXPIRATION_DAYS;
}

export function formatExpirationWindowLabel(days: number): string {
  return `${Math.max(0, Math.floor(days || 0))} days`;
}

export function getRetentionPolicyNotice() {
  const freeAndPromoLabel = `Free and Promo documents expire after ${FREE_PLAN_EXPIRATION_DAYS} days.`;
  const paidProLabel = `Paid Pro documents expire after ${PAID_PRO_PLAN_EXPIRATION_DAYS} days.`;
  const summary = `If you stay signed out for ${SIGNED_OUT_DOCUMENT_CLEANUP_DAYS} days, your uploaded documents will be deleted. Documents uploaded on Free and Promo plans expire after ${FREE_PLAN_EXPIRATION_DAYS} days. Documents uploaded on the paid Pro plan expire after ${PAID_PRO_PLAN_EXPIRATION_DAYS} days.`;
  return {
    signedOutDays: SIGNED_OUT_DOCUMENT_CLEANUP_DAYS,
    freeDays: FREE_PLAN_EXPIRATION_DAYS,
    promoDays: PROMO_PLAN_EXPIRATION_DAYS,
    paidProDays: PAID_PRO_PLAN_EXPIRATION_DAYS,
    freeAndPromoLabel,
    paidProLabel,
    summary,
  };
}

export function prorateExpirationTimestamp(input: {
  currentExpiresAt: string | null | undefined;
  previousExpirationDays: number;
  nextExpirationDays: number;
  now?: Date;
}): string {
  const now = input.now instanceof Date ? input.now : new Date();
  const nextWindowMs = Math.max(1, Math.floor(input.nextExpirationDays || 0)) * DAY_MS;
  if (nextWindowMs <= 0) {
    return now.toISOString();
  }

  const currentExpiryMs = new Date(String(input.currentExpiresAt || '')).getTime();
  if (!Number.isFinite(currentExpiryMs) || currentExpiryMs <= now.getTime()) {
    return new Date(now.getTime() + nextWindowMs).toISOString();
  }

  const previousWindowMs = Math.max(1, Math.floor(input.previousExpirationDays || 0)) * DAY_MS;
  const remainingRatio = Math.max(0, Math.min(1, (currentExpiryMs - now.getTime()) / previousWindowMs));
  return new Date(now.getTime() + Math.round(remainingRatio * nextWindowMs)).toISOString();
}

export function resolvePlanTransitionKind(input: {
  previousPlan?: string | null | undefined;
  previousEntitlementSource?: string | null | undefined;
  nextPlan?: string | null | undefined;
  nextEntitlementSource?: string | null | undefined;
}): PlanTransitionKind {
  const previousDays = resolvePlanExpirationDays({
    plan: input.previousPlan,
    entitlementSource: input.previousEntitlementSource,
  });
  const nextDays = resolvePlanExpirationDays({
    plan: input.nextPlan,
    entitlementSource: input.nextEntitlementSource,
  });

  if (nextDays > previousDays) return 'upgrade';
  if (nextDays < previousDays) return 'downgrade';

  const previousSource = normalizeEntitlementSource(input.previousEntitlementSource);
  const nextSource = normalizeEntitlementSource(input.nextEntitlementSource);
  if (previousSource !== nextSource || normalizeManagedPlan(input.previousPlan) !== normalizeManagedPlan(input.nextPlan)) {
    return 'renewal';
  }
  return 'sync';
}
