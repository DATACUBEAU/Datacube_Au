const OWNER_ADMIN_USER_ID_ENV = 'DATACUBE_OWNER_ADMIN_USER_ID';

export function getProtectedOwnerUserId(): string {
  const configured =
    typeof process !== 'undefined'
      ? process.env?.[OWNER_ADMIN_USER_ID_ENV]
      : null;
  return String(configured || '').trim().toLowerCase();
}

export const PLATFORM_OWNER_USER_ID = getProtectedOwnerUserId();

export function hasProtectedOwnerConfigured(): boolean {
  return Boolean(getProtectedOwnerUserId());
}

export const ADMIN_OVERRIDE_PLANS = ['free', 'pro_weekly', 'pro_monthly', 'premium'] as const;

export type AdminOverridePlan = (typeof ADMIN_OVERRIDE_PLANS)[number];

const ADMIN_OVERRIDE_PLAN_SET = new Set<string>(ADMIN_OVERRIDE_PLANS);

export function isProtectedOwnerUserId(userId: unknown): boolean {
  const ownerUserId = getProtectedOwnerUserId();
  return Boolean(ownerUserId && String(userId || '').trim().toLowerCase() === ownerUserId);
}

export function normalizeAdminOverridePlan(value: unknown): AdminOverridePlan | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'free') return 'free';
  if (normalized === 'premium') return 'premium';
  if (normalized === 'weekly' || normalized === 'pro_weekly') return 'pro_weekly';
  if (normalized === 'monthly' || normalized === 'pro_monthly' || normalized === 'pro') return 'pro_monthly';
  return ADMIN_OVERRIDE_PLAN_SET.has(normalized) ? (normalized as AdminOverridePlan) : null;
}

export function isAdminOverridePlan(value: unknown): value is AdminOverridePlan {
  return normalizeAdminOverridePlan(value) === value;
}

export function isPaidAdminOverridePlan(value: unknown): boolean {
  const normalized = normalizeAdminOverridePlan(value);
  return normalized === 'pro_weekly' || normalized === 'pro_monthly' || normalized === 'premium';
}

export function adminOverridePlanLabel(value: AdminOverridePlan | null | undefined): string {
  if (value === 'premium') return 'Premium';
  if (value === 'pro_weekly') return 'Pro Weekly';
  if (value === 'pro_monthly') return 'Pro Monthly';
  return 'Free';
}
