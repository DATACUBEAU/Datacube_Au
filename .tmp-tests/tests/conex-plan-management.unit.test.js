"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const plan_management_js_1 = require("../src/lib/conex/plan-management.js");
const promo_content_js_1 = require("../src/lib/conex/promo-content.js");
let failed = 0;
function run(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
const limitKeys = [
    'max_file_size_mb',
    'max_uploads_total',
    'max_chats_total',
    'max_tokens_total',
    'max_concurrent_jobs',
    'max_exam_predictions',
    'max_practice_exams',
    'max_knowledge_hub',
];
run('parsePlanLimitsPayload supports nested limitsByPlan.plan.limits shape', () => {
    const payload = {
        limitsByPlan: {
            free: {
                limits: {
                    max_file_size_mb: 50,
                    max_uploads_total: 4,
                    max_knowledge_hub: 8,
                },
            },
            pro: {
                limits: {
                    max_file_size_mb: '100',
                    max_uploads_total: '10',
                    max_concurrent_jobs: 8,
                },
            },
        },
    };
    const parsed = (0, plan_management_js_1.parsePlanLimitsPayload)(payload, limitKeys);
    strict_1.default.deepEqual(parsed.planKeys, ['free', 'pro']);
    strict_1.default.equal(parsed.limitsByPlan.free.max_file_size_mb, 50);
    strict_1.default.equal(parsed.limitsByPlan.pro.max_file_size_mb, 100);
    strict_1.default.equal(parsed.limitsByPlan.pro.max_uploads_total, 10);
    strict_1.default.equal(parsed.limitsByPlan.pro.max_concurrent_jobs, 8);
    strict_1.default.equal(parsed.limitsByPlan.pro.max_knowledge_hub, null);
});
run('parsePlanLimitsPayload supports array payload shape and direct plan fields', () => {
    const payload = {
        data: {
            planLimits: [
                {
                    plan: 'weekly',
                    limits: { max_file_size_mb: 80, max_uploads_total: 9 },
                },
                {
                    plan: 'monthly',
                    max_file_size_mb: 120,
                    max_uploads_total: 20,
                },
            ],
        },
    };
    const parsed = (0, plan_management_js_1.parsePlanLimitsPayload)(payload, limitKeys);
    strict_1.default.deepEqual(parsed.planKeys, ['weekly', 'monthly']);
    strict_1.default.equal(parsed.limitsByPlan.weekly.max_file_size_mb, 80);
    strict_1.default.equal(parsed.limitsByPlan.monthly.max_file_size_mb, 120);
    strict_1.default.equal(parsed.limitsByPlan.monthly.max_uploads_total, 20);
});
run('plan switch keeps each plan limit value instead of collapsing to zero', () => {
    const payload = {
        limitsByPlan: {
            free: {
                limits: {
                    max_uploads_total: 4,
                    max_file_size_mb: 50,
                },
            },
            pro: {
                limits: {
                    max_uploads_total: 10,
                    max_file_size_mb: 100,
                },
            },
        },
    };
    const parsed = (0, plan_management_js_1.parsePlanLimitsPayload)(payload, limitKeys);
    const drafts = (0, plan_management_js_1.toPlanLimitDraftByPlan)(parsed.limitsByPlan, limitKeys);
    strict_1.default.equal(drafts.free.max_uploads_total, '4');
    strict_1.default.equal(drafts.pro.max_uploads_total, '10');
    strict_1.default.equal(drafts.free.max_file_size_mb, '50');
    strict_1.default.equal(drafts.pro.max_file_size_mb, '100');
});
run('validatePlanLimitDraft normalizes empty values to 0 caps', () => {
    const draft = {
        free: {
            max_file_size_mb: '50',
            max_uploads_total: '',
            max_chats_total: '',
            max_tokens_total: '',
            max_concurrent_jobs: '2',
            max_exam_predictions: '',
            max_practice_exams: '',
            max_knowledge_hub: '004',
        },
    };
    const result = (0, plan_management_js_1.validatePlanLimitDraft)(draft, 'free', limitKeys);
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(result.limits.max_file_size_mb, 50);
    strict_1.default.equal(result.limits.max_uploads_total, 0);
    strict_1.default.equal(result.limits.max_knowledge_hub, 4);
    strict_1.default.equal(result.limits.max_concurrent_jobs, 2);
});
run('validatePlanLimitDraft rejects non-integer values', () => {
    const draft = {
        pro: {
            max_file_size_mb: '40.5',
            max_uploads_total: 'abc',
            max_chats_total: '2',
            max_tokens_total: '2000',
            max_concurrent_jobs: '2',
            max_exam_predictions: '2',
            max_practice_exams: '2',
            max_knowledge_hub: '10',
        },
    };
    const result = (0, plan_management_js_1.validatePlanLimitDraft)(draft, 'pro', limitKeys);
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.errors.length >= 1, true);
});
run('promo content config normalizes and renders expected copy', () => {
    const config = (0, promo_content_js_1.normalizePromoContentConfig)({
        introText: 'You are currently on Promo Pro.',
        pricingTemplate: 'On {effectiveDate}, Pro becomes NGN {monthlyPrice}/month or NGN {weeklyPrice}/week.',
        endsTemplate: 'Promo ends at {promoEndsAt} {timezone} time.',
        effectiveDateLabel: 'April 2nd, 2026',
        monthlyPriceNgn: 4500,
        weeklyPriceNgn: 1500,
        promoEndsAtLagosIso: '2026-04-02T00:00:00+01:00',
        timezoneLabel: 'Africa/Lagos',
    });
    const endsLabel = (0, promo_content_js_1.formatPromoEndsAtLabel)(config.promoEndsAtLagosIso);
    const copy = (0, promo_content_js_1.buildPromoCopy)(config, endsLabel);
    strict_1.default.equal(copy.intro, 'You are currently on Promo Pro.');
    strict_1.default.ok(copy.pricing.includes('NGN 4,500/month'));
    strict_1.default.ok(copy.pricing.includes('NGN 1,500/week'));
    strict_1.default.ok(copy.ending.includes('Africa/Lagos'));
});
run('default promo copy matches required launch message tokens', () => {
    const config = (0, promo_content_js_1.normalizePromoContentConfig)(promo_content_js_1.DEFAULT_PROMO_CONTENT_CONFIG);
    const endsLabel = (0, promo_content_js_1.formatPromoEndsAtLabel)(config.promoEndsAtLagosIso);
    const copy = (0, promo_content_js_1.buildPromoCopy)(config, endsLabel);
    strict_1.default.equal(copy.intro, 'You are currently on Promo Pro.');
    strict_1.default.ok(copy.pricing.includes('April 2nd, 2026'));
    strict_1.default.ok(copy.pricing.includes('NGN 4,500/month'));
    strict_1.default.ok(copy.pricing.includes('NGN 1,500/week'));
});
run('validatePromoContentDraft reports invalid pricing and date format', () => {
    const draft = (0, promo_content_js_1.toPromoContentDraft)((0, promo_content_js_1.normalizePromoContentConfig)({}));
    draft.monthlyPriceNgn = '-1';
    draft.promoEndsAtLagosIso = 'not-a-date';
    const result = (0, promo_content_js_1.validatePromoContentDraft)(draft);
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.errors.length >= 1, true);
});
if (failed > 0)
    process.exit(1);
