"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const feature_access_js_1 = require("../src/lib/feature-access.js");
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
const freeEntitlements = {
    userId: 'user-free',
    plan: 'free',
    hasPro: false,
    entitlementSource: 'none',
    entitlementEndsAt: null,
    billingEnabled: true,
    promoEnabled: false,
    promoActive: false,
    canAccessBilling: true,
    promoBannerEnabled: false,
    promoContentConfig: {},
    promoEndsAtUtc: null,
    promoEndsAtLagos: null,
    asOf: null,
    source: 'test',
};
const proEntitlements = {
    ...freeEntitlements,
    userId: 'user-pro',
    plan: 'pro',
    hasPro: true,
    entitlementSource: 'paid',
};
run('paid access helper allows pro users and blocks free users', () => {
    strict_1.default.equal((0, feature_access_js_1.hasPaidFeatureAccess)(freeEntitlements), false);
    strict_1.default.equal((0, feature_access_js_1.hasPaidFeatureAccess)(proEntitlements), true);
});
run('knowledge hub blocks free users when pro is required', () => {
    const access = (0, feature_access_js_1.getDashboardFeatureAccess)('knowledge_hub', freeEntitlements, {
        enable_knowledge_hub: { enabled: true },
        pro_required_knowledge_hub: { enabled: true },
    });
    strict_1.default.equal(access.allowed, false);
    strict_1.default.equal(access.code, 'PRO_REQUIRED');
});
run('knowledge hub allows pro users when enabled', () => {
    const access = (0, feature_access_js_1.getDashboardFeatureAccess)('knowledge_hub', proEntitlements, {
        enable_knowledge_hub: { enabled: true },
        pro_required_knowledge_hub: { enabled: true },
    });
    strict_1.default.equal(access.allowed, true);
    strict_1.default.equal(access.code, null);
});
run('practice exam requires paid access when enabled', () => {
    const access = (0, feature_access_js_1.getDashboardFeatureAccess)('practice_exam_generation', freeEntitlements, {
        enable_practice_exam_generation: { enabled: true },
    });
    strict_1.default.equal(access.allowed, false);
    strict_1.default.equal(access.proRequired, true);
    strict_1.default.equal(access.code, 'PRO_REQUIRED');
});
run('feature-disabled access returns disabled code and keeps upgrade source stable', () => {
    const access = (0, feature_access_js_1.getDashboardFeatureAccess)('exam_prediction', proEntitlements, {
        enable_exam_prediction: { enabled: false },
    });
    strict_1.default.equal(access.allowed, false);
    strict_1.default.equal(access.code, 'FEATURE_DISABLED');
    const upgrade = (0, feature_access_js_1.buildUpgradeContext)(access);
    strict_1.default.equal(upgrade.key, 'exam_prediction');
    strict_1.default.ok(String(upgrade.upgradeUrl).includes('feature_exam_prediction'));
});
if (failed > 0)
    process.exit(1);
