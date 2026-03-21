"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BILLING_PLAN_CATALOG = exports.BILLING_PLAN_CODES = void 0;
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
