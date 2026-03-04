import assert from 'node:assert/strict';
import {
  parsePlanLimitsPayload,
  toPlanLimitDraftByPlan,
  validatePlanLimitDraft,
  type PlanLimitDraftByPlan,
} from '../src/lib/conex/plan-management.js';
import {
  DEFAULT_PROMO_CONTENT_CONFIG,
  buildPromoCopy,
  formatPromoEndsAtLabel,
  normalizePromoContentConfig,
  toPromoContentDraft,
  validatePromoContentDraft,
} from '../src/lib/conex/promo-content.js';

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

const limitKeys = [
  'max_file_mb',
  'max_uploads_total',
  'max_docs_total',
  'max_chats_total',
  'max_exams_total',
  'max_tokens_total',
  'max_storage_mb',
  'max_jobs_concurrent',
];

run('parsePlanLimitsPayload supports nested limitsByPlan.plan.limits shape', () => {
  const payload = {
    limitsByPlan: {
      free: {
        limits: {
          max_file_mb: 50,
          max_uploads_total: 4,
        },
      },
      pro: {
        limits: {
          max_file_mb: '100',
          max_uploads_total: '10',
          max_jobs_concurrent: 8,
        },
      },
    },
  };

  const parsed = parsePlanLimitsPayload(payload, limitKeys);
  assert.deepEqual(parsed.planKeys, ['free', 'pro']);
  assert.equal(parsed.limitsByPlan.free.max_file_mb, 50);
  assert.equal(parsed.limitsByPlan.pro.max_file_mb, 100);
  assert.equal(parsed.limitsByPlan.pro.max_uploads_total, 10);
  assert.equal(parsed.limitsByPlan.pro.max_jobs_concurrent, 8);
  assert.equal(parsed.limitsByPlan.pro.max_storage_mb, null);
});

run('parsePlanLimitsPayload supports array payload shape and direct plan fields', () => {
  const payload = {
    data: {
      planLimits: [
        {
          plan: 'weekly',
          limits: { max_file_mb: 80, max_uploads_total: 9 },
        },
        {
          plan: 'monthly',
          max_file_mb: 120,
          max_uploads_total: 20,
        },
      ],
    },
  };

  const parsed = parsePlanLimitsPayload(payload, limitKeys);
  assert.deepEqual(parsed.planKeys, ['weekly', 'monthly']);
  assert.equal(parsed.limitsByPlan.weekly.max_file_mb, 80);
  assert.equal(parsed.limitsByPlan.monthly.max_file_mb, 120);
  assert.equal(parsed.limitsByPlan.monthly.max_uploads_total, 20);
});

run('plan switch keeps each plan limit value instead of collapsing to zero', () => {
  const payload = {
    limitsByPlan: {
      free: {
        limits: {
          max_uploads_total: 4,
          max_file_mb: 50,
        },
      },
      pro: {
        limits: {
          max_uploads_total: 10,
          max_file_mb: 100,
        },
      },
    },
  };

  const parsed = parsePlanLimitsPayload(payload, limitKeys);
  const drafts = toPlanLimitDraftByPlan(parsed.limitsByPlan, limitKeys);

  assert.equal(drafts.free.max_uploads_total, '4');
  assert.equal(drafts.pro.max_uploads_total, '10');
  assert.equal(drafts.free.max_file_mb, '50');
  assert.equal(drafts.pro.max_file_mb, '100');
});

run('validatePlanLimitDraft normalizes empty values to unlimited (0)', () => {
  const draft: PlanLimitDraftByPlan = {
    free: {
      max_file_mb: '50',
      max_uploads_total: '',
      max_docs_total: '004',
      max_chats_total: '',
      max_exams_total: '',
      max_tokens_total: '',
      max_storage_mb: '',
      max_jobs_concurrent: '2',
    },
  };

  const result = validatePlanLimitDraft(draft, 'free', limitKeys);
  assert.equal(result.ok, true);
  assert.equal(result.limits.max_file_mb, 50);
  assert.equal(result.limits.max_uploads_total, 0);
  assert.equal(result.limits.max_docs_total, 4);
  assert.equal(result.limits.max_jobs_concurrent, 2);
});

run('validatePlanLimitDraft rejects non-integer values', () => {
  const draft: PlanLimitDraftByPlan = {
    pro: {
      max_file_mb: '40.5',
      max_uploads_total: 'abc',
      max_docs_total: '10',
      max_chats_total: '2',
      max_exams_total: '2',
      max_tokens_total: '2000',
      max_storage_mb: '50',
      max_jobs_concurrent: '2',
    },
  };

  const result = validatePlanLimitDraft(draft, 'pro', limitKeys);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length >= 1, true);
});

run('promo content config normalizes and renders expected copy', () => {
  const config = normalizePromoContentConfig({
    introText: 'You are currently on Promo Pro.',
    pricingTemplate: 'On {effectiveDate}, Pro becomes NGN {monthlyPrice}/month or NGN {weeklyPrice}/week.',
    endsTemplate: 'Promo ends at {promoEndsAt} {timezone} time.',
    effectiveDateLabel: 'April 2nd, 2026',
    monthlyPriceNgn: 4500,
    weeklyPriceNgn: 1500,
    promoEndsAtLagosIso: '2026-04-02T00:00:00+01:00',
    timezoneLabel: 'Africa/Lagos',
  });
  const endsLabel = formatPromoEndsAtLabel(config.promoEndsAtLagosIso);
  const copy = buildPromoCopy(config, endsLabel);

  assert.equal(copy.intro, 'You are currently on Promo Pro.');
  assert.ok(copy.pricing.includes('NGN 4,500/month'));
  assert.ok(copy.pricing.includes('NGN 1,500/week'));
  assert.ok(copy.ending.includes('Africa/Lagos'));
});

run('default promo copy matches required launch message tokens', () => {
  const config = normalizePromoContentConfig(DEFAULT_PROMO_CONTENT_CONFIG);
  const endsLabel = formatPromoEndsAtLabel(config.promoEndsAtLagosIso);
  const copy = buildPromoCopy(config, endsLabel);

  assert.equal(copy.intro, 'You are currently on Promo Pro.');
  assert.ok(copy.pricing.includes('April 2nd, 2026'));
  assert.ok(copy.pricing.includes('NGN 4,500/month'));
  assert.ok(copy.pricing.includes('NGN 1,500/week'));
});

run('validatePromoContentDraft reports invalid pricing and date format', () => {
  const draft = toPromoContentDraft(normalizePromoContentConfig({}));
  draft.monthlyPriceNgn = '-1';
  draft.promoEndsAtLagosIso = 'not-a-date';

  const result = validatePromoContentDraft(draft);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length >= 1, true);
});

if (failed > 0) process.exit(1);
