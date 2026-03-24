"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BILLING_PLAN_CATALOG = exports.BILLING_PLAN_CODES = void 0;
exports.resolveBillingPlanCatalogEntry = resolveBillingPlanCatalogEntry;
exports.resolveConfiguredBillingPlanCode = resolveConfiguredBillingPlanCode;
exports.resolveBillingPlanCode = resolveBillingPlanCode;
exports.resolveBillingPlanKeyByAmount = resolveBillingPlanKeyByAmount;
exports.materializeBillingPlanRow = materializeBillingPlanRow;
const plans_1 = require("../billing/plans");
const env_1 = require("./env");
exports.BILLING_PLAN_CODES = {
    pro_weekly: 'PLN_h3teb0z285iuyet',
    pro_monthly: 'PLN_bo7k3ulauwdhzjl',
};
exports.DEFAULT_BILLING_PLAN_CATALOG = [
    {
        planKey: 'pro_monthly',
        interval: 'monthly',
        amountKobo: 450000,
        envCodes: [
            'PAYSTACK_PLAN_MONTHLY_CODE',
            'PAYSTACK_PRO_MONTHLY_PLAN_CODE',
            'DATACUBE_PRO_MONTHLY_PLAN_CODE',
        ],
        fallbackPaystackPlanCode: exports.BILLING_PLAN_CODES.pro_monthly,
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
        fallbackPaystackPlanCode: exports.BILLING_PLAN_CODES.pro_weekly,
    },
];
function resolveBillingPlanCatalogEntry(planKeyRaw) {
    const planKey = (0, plans_1.normalizeCanonicalBillingPlanKey)(planKeyRaw);
    if (planKey !== 'pro_weekly' && planKey !== 'pro_monthly') {
        return null;
    }
    return exports.DEFAULT_BILLING_PLAN_CATALOG.find((entry) => entry.planKey === planKey) || null;
}
function resolveConfiguredBillingPlanCode(plan) {
    return (0, env_1.firstEnv)(...plan.envCodes);
}
function resolveBillingPlanCode(plan) {
    return resolveConfiguredBillingPlanCode(plan) || plan.fallbackPaystackPlanCode;
}
function resolveBillingPlanKeyByAmount(amountKoboRaw) {
    const amountKobo = Math.max(0, Math.round(Number(amountKoboRaw || 0)));
    if (!amountKobo)
        return null;
    const match = exports.DEFAULT_BILLING_PLAN_CATALOG.find((entry) => entry.amountKobo === amountKobo);
    return match?.planKey || null;
}
function materializeBillingPlanRow(input) {
    const catalogEntry = resolveBillingPlanCatalogEntry(input.row?.plan_key ?? input.planKeyRaw) ||
        resolveBillingPlanCatalogEntry(input.planKeyRaw);
    if (!catalogEntry) {
        return null;
    }
    const normalizedPlanKey = (0, plans_1.normalizeCanonicalBillingPlanKey)(input.row?.plan_key);
    const normalizedInterval = String(input.row?.interval || '').trim().toLowerCase();
    const configuredPlanCode = resolveConfiguredBillingPlanCode(catalogEntry);
    const rowPlanCode = String(input.row?.paystack_plan_code || '').trim();
    const amountKobo = Math.max(0, Math.round(Number(input.row?.amount_kobo || 0)));
    return {
        plan_key: normalizedPlanKey === 'pro_weekly' || normalizedPlanKey === 'pro_monthly'
            ? normalizedPlanKey
            : catalogEntry.planKey,
        interval: normalizedInterval === 'weekly' || normalizedInterval === 'monthly'
            ? normalizedInterval
            : catalogEntry.interval,
        amount_kobo: amountKobo > 0 ? amountKobo : catalogEntry.amountKobo,
        paystack_plan_code: configuredPlanCode || rowPlanCode || catalogEntry.fallbackPaystackPlanCode,
        is_active: input.row?.is_active == null ? true : Boolean(input.row.is_active),
        source: input.row ? 'database' : 'default_catalog',
    };
}
