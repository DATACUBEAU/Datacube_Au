export type BillingPlanInterval = 'weekly' | 'monthly';

export type BillingPlanCatalogEntry = {
  planKey: 'pro_weekly' | 'pro_monthly';
  interval: BillingPlanInterval;
  amountKobo: number;
  envCodes: string[];
  fallbackPaystackPlanCode: string;
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
