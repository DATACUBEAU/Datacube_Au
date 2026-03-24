import { normalizeCanonicalBillingPlanKey } from '../billing/plans';
import { firstEnv } from './env';

export type BillingPlanInterval = 'weekly' | 'monthly';

export type BillingPlanCatalogEntry = {
  planKey: 'pro_weekly' | 'pro_monthly';
  interval: BillingPlanInterval;
  amountKobo: number;
  envCodes: string[];
  fallbackPaystackPlanCode: string;
};

export type MaterializedBillingPlanRow = {
  plan_key: BillingPlanCatalogEntry['planKey'];
  interval: BillingPlanInterval;
  amount_kobo: number;
  paystack_plan_code: string | null;
  is_active: boolean;
  source: 'database' | 'default_catalog';
};

export const BILLING_PLAN_CODES = {
  pro_weekly: 'PLN_h3teb0z285iuyet',
  pro_monthly: 'PLN_bo7k3ulauwdhzjl',
} as const;

export const DEFAULT_BILLING_PLAN_CATALOG: BillingPlanCatalogEntry[] = [
  {
    planKey: 'pro_monthly',
    interval: 'monthly',
    amountKobo: 450000,
    envCodes: [
      'PAYSTACK_PLAN_MONTHLY_CODE',
      'PAYSTACK_PRO_MONTHLY_PLAN_CODE',
      'DATACUBE_PRO_MONTHLY_PLAN_CODE',
    ],
    fallbackPaystackPlanCode: BILLING_PLAN_CODES.pro_monthly,
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
    fallbackPaystackPlanCode: BILLING_PLAN_CODES.pro_weekly,
  },
];

export function resolveBillingPlanCatalogEntry(planKeyRaw: unknown): BillingPlanCatalogEntry | null {
  const planKey = normalizeCanonicalBillingPlanKey(planKeyRaw);
  if (planKey !== 'pro_weekly' && planKey !== 'pro_monthly') {
    return null;
  }
  return DEFAULT_BILLING_PLAN_CATALOG.find((entry) => entry.planKey === planKey) || null;
}

export function resolveConfiguredBillingPlanCode(plan: BillingPlanCatalogEntry): string | null {
  return firstEnv(...plan.envCodes);
}

export function resolveBillingPlanCode(plan: BillingPlanCatalogEntry): string {
  return resolveConfiguredBillingPlanCode(plan) || plan.fallbackPaystackPlanCode;
}

export function resolveBillingPlanKeyByAmount(amountKoboRaw: unknown): BillingPlanCatalogEntry['planKey'] | null {
  const amountKobo = Math.max(0, Math.round(Number(amountKoboRaw || 0)));
  if (!amountKobo) return null;
  const match = DEFAULT_BILLING_PLAN_CATALOG.find((entry) => entry.amountKobo === amountKobo);
  return match?.planKey || null;
}

export function materializeBillingPlanRow(input: {
  planKeyRaw: unknown;
  row?: Partial<{
    plan_key: unknown;
    interval: unknown;
    amount_kobo: unknown;
    paystack_plan_code: unknown;
    is_active: unknown;
  }> | null;
}): MaterializedBillingPlanRow | null {
  const catalogEntry =
    resolveBillingPlanCatalogEntry(input.row?.plan_key ?? input.planKeyRaw) ||
    resolveBillingPlanCatalogEntry(input.planKeyRaw);
  if (!catalogEntry) {
    return null;
  }

  const normalizedPlanKey = normalizeCanonicalBillingPlanKey(input.row?.plan_key);
  const normalizedInterval = String(input.row?.interval || '').trim().toLowerCase();
  const configuredPlanCode = resolveConfiguredBillingPlanCode(catalogEntry);
  const rowPlanCode = String(input.row?.paystack_plan_code || '').trim();
  const amountKobo = Math.max(0, Math.round(Number(input.row?.amount_kobo || 0)));

  return {
    plan_key:
      normalizedPlanKey === 'pro_weekly' || normalizedPlanKey === 'pro_monthly'
        ? normalizedPlanKey
        : catalogEntry.planKey,
    interval:
      normalizedInterval === 'weekly' || normalizedInterval === 'monthly'
        ? normalizedInterval
        : catalogEntry.interval,
    amount_kobo: amountKobo > 0 ? amountKobo : catalogEntry.amountKobo,
    paystack_plan_code: configuredPlanCode || rowPlanCode || catalogEntry.fallbackPaystackPlanCode,
    is_active: input.row?.is_active == null ? true : Boolean(input.row.is_active),
    source: input.row ? 'database' : 'default_catalog',
  };
}
