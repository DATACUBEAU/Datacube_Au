export type EffectiveEntitlementPlan = 'free' | 'pro' | 'promo_pro' | 'premium' | 'admin';
export type CanonicalBillingPlanKey = 'free' | 'pro' | 'pro_weekly' | 'pro_monthly' | 'premium';
export type CanonicalBillingManagedPlan = 'free' | 'pro' | 'premium';
export type CanonicalBillingInterval = 'weekly' | 'monthly' | null;
export type CanonicalEntitlementSource = 'paid' | 'promo' | 'none';

const DIRECT_PLAN_KEY_MAP: Record<string, CanonicalBillingPlanKey> = {
  free: 'free',
  basic: 'free',
  starter: 'free',
  none: 'free',
  pro: 'pro',
  paid: 'pro',
  promo_pro: 'pro',
  premium: 'premium',
  weekly: 'pro_weekly',
  pro_weekly: 'pro_weekly',
  weekly_pro: 'pro_weekly',
  monthly: 'pro_monthly',
  pro_monthly: 'pro_monthly',
  monthly_pro: 'pro_monthly',
};

function normalizePlanText(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function tokenizePlan(raw: unknown): string[] {
  return normalizePlanText(raw)
    .split(/[_\s-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function normalizeBillingEntitlementSource(raw: unknown): CanonicalEntitlementSource {
  const value = normalizePlanText(raw);
  if (value === 'paid') return 'paid';
  if (value === 'promo') return 'promo';
  return 'none';
}

export function normalizeCanonicalBillingPlanKey(raw: unknown): CanonicalBillingPlanKey | null {
  const value = normalizePlanText(raw);
  if (!value) return null;

  if (DIRECT_PLAN_KEY_MAP[value]) {
    return DIRECT_PLAN_KEY_MAP[value];
  }

  const tokens = tokenizePlan(raw);
  const hasPro = tokens.includes('pro') || tokens.includes('paid');
  const hasPremium = tokens.includes('premium');
  const hasWeekly = tokens.includes('weekly');
  const hasMonthly = tokens.includes('monthly');

  if (hasPremium) return 'premium';
  if (hasWeekly && (hasPro || tokens.length === 1)) return 'pro_weekly';
  if (hasMonthly && (hasPro || tokens.length === 1)) return 'pro_monthly';
  if (hasPro) return 'pro';
  if (tokens.includes('free') || tokens.includes('basic') || tokens.includes('starter')) return 'free';

  return null;
}

export function normalizeEffectiveEntitlementPlan(raw: unknown): EffectiveEntitlementPlan {
  const value = normalizePlanText(raw);
  if (value === 'admin') return 'admin';
  if (value === 'premium') return 'premium';
  if (value === 'promo_pro') return 'promo_pro';

  const billingPlanKey = normalizeCanonicalBillingPlanKey(raw);
  if (billingPlanKey === 'premium') return 'premium';
  if (billingPlanKey === 'pro' || billingPlanKey === 'pro_weekly' || billingPlanKey === 'pro_monthly') {
    return 'pro';
  }

  return 'free';
}

export function normalizeBillingManagedPlan(raw: unknown): CanonicalBillingManagedPlan {
  const value = normalizePlanText(raw);
  if (value === 'admin') return 'premium';

  const billingPlanKey = normalizeCanonicalBillingPlanKey(raw);
  if (billingPlanKey === 'premium') return 'premium';
  if (billingPlanKey === 'pro' || billingPlanKey === 'pro_weekly' || billingPlanKey === 'pro_monthly') {
    return 'pro';
  }
  return 'free';
}

export function normalizeBillingInterval(raw: unknown): CanonicalBillingInterval {
  const billingPlanKey = normalizeCanonicalBillingPlanKey(raw);
  if (billingPlanKey === 'pro_weekly') return 'weekly';
  if (billingPlanKey === 'pro_monthly') return 'monthly';

  const tokens = tokenizePlan(raw);
  if (tokens.includes('weekly')) return 'weekly';
  if (tokens.includes('monthly')) return 'monthly';
  return null;
}

export function isPaidBillingPlanKey(planKey: CanonicalBillingPlanKey | null | undefined): boolean {
  return planKey === 'premium' || planKey === 'pro' || planKey === 'pro_weekly' || planKey === 'pro_monthly';
}

export function isProBillingPlanKey(planKey: CanonicalBillingPlanKey | null | undefined): boolean {
  return planKey === 'pro' || planKey === 'pro_weekly' || planKey === 'pro_monthly';
}

export function formatBillingPlanLabel(planKey: CanonicalBillingPlanKey | null | undefined): string {
  switch (planKey) {
    case 'free':
      return 'Free';
    case 'pro_weekly':
      return 'Pro Weekly';
    case 'pro_monthly':
      return 'Pro Monthly';
    case 'premium':
      return 'Premium';
    case 'pro':
      return 'Pro';
    default:
      return 'Free';
  }
}

export function isMatchingBillingPlanKey(
  currentPlanKey: CanonicalBillingPlanKey | null | undefined,
  candidate: unknown,
): boolean {
  const candidatePlanKey = normalizeCanonicalBillingPlanKey(candidate);
  if (!currentPlanKey || !candidatePlanKey) return false;
  if (currentPlanKey === candidatePlanKey) return true;
  return currentPlanKey === 'pro' && isProBillingPlanKey(candidatePlanKey);
}
