
export const PRICING_CONFIG = {
  weekly: {
    amount: 1900,
    compare_at: 2500,
    label: "Save 24%",
    plan_code_env: "PAYSTACK_PLAN_WEEKLY",
    interval: "weekly"
  },
  monthly: {
    amount: 4500,
    compare_at: 6000,
    label: "Save 25%",
    plan_code_env: "PAYSTACK_PLAN_MONTHLY",
    interval: "monthly"
  }
};

export function getPlanCode(interval: 'weekly' | 'monthly'): string | undefined {
  const envKey = PRICING_CONFIG[interval].plan_code_env;
  const envValue = Deno.env.get(envKey);
  return envValue;
}
