import assert from 'node:assert/strict';
import { buildUpgradeContext, getDashboardFeatureAccess, hasPaidFeatureAccess } from '../src/lib/feature-access.js';

let failed = 0;

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

const freeEntitlements: any = {
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

const proEntitlements: any = {
  ...freeEntitlements,
  userId: 'user-pro',
  plan: 'pro',
  hasPro: true,
  entitlementSource: 'paid',
};

run('paid access helper allows pro users and blocks free users', () => {
  assert.equal(hasPaidFeatureAccess(freeEntitlements), false);
  assert.equal(hasPaidFeatureAccess(proEntitlements), true);
});

run('knowledge hub blocks free users when pro is required', () => {
  const access = getDashboardFeatureAccess('knowledge_hub', freeEntitlements, {
    enable_knowledge_hub: { enabled: true },
    pro_required_knowledge_hub: { enabled: true },
  } as any);

  assert.equal(access.allowed, false);
  assert.equal(access.code, 'PRO_REQUIRED');
});

run('knowledge hub allows pro users when enabled', () => {
  const access = getDashboardFeatureAccess('knowledge_hub', proEntitlements, {
    enable_knowledge_hub: { enabled: true },
    pro_required_knowledge_hub: { enabled: true },
  } as any);

  assert.equal(access.allowed, true);
  assert.equal(access.code, null);
});

run('practice exam remains available to free users when enabled', () => {
  const access = getDashboardFeatureAccess('practice_exam_generation', freeEntitlements, {
    enable_practice_exam_generation: { enabled: true },
  } as any);

  assert.equal(access.allowed, true);
  assert.equal(access.proRequired, false);
});

run('feature-disabled access returns disabled code and keeps upgrade source stable', () => {
  const access = getDashboardFeatureAccess('exam_prediction', proEntitlements, {
    enable_exam_prediction: { enabled: false },
  } as any);

  assert.equal(access.allowed, false);
  assert.equal(access.code, 'FEATURE_DISABLED');

  const upgrade = buildUpgradeContext(access);
  assert.equal(upgrade.key, 'exam_prediction');
  assert.ok(String(upgrade.upgradeUrl).includes('feature_exam_prediction'));
});

if (failed > 0) process.exit(1);
