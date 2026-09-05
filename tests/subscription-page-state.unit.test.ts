import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractBillingReturnState } from '../src/lib/billing/payment-return.js';
import {
  buildSubscriptionBootstrapKey,
  buildSubscriptionUsageRows,
  hasMeaningfulSubscriptionUsageData,
} from '../src/lib/billing/subscription-page-state.js';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

async function run(name: string, fn: AsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function readProjectFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function main() {
  await run('stable bootstrap keys do not change when the same callback params are re-read', () => {
    const paymentReturn = extractBillingReturnState(new URLSearchParams({
      reference: 'DCAU-123',
      success: 'true',
    }));

    const firstKey = buildSubscriptionBootstrapKey('user-1', paymentReturn);
    const secondKey = buildSubscriptionBootstrapKey('user-1', paymentReturn);

    assert.equal(firstKey, 'user-1:DCAU-123|DCAU-123|||1|0|1');
    assert.equal(secondKey, firstKey);
  });

  await run('bootstrap keys change only when the callback state actually changes', () => {
    const successReturn = extractBillingReturnState(new URLSearchParams({
      reference: 'DCAU-123',
      success: 'true',
    }));
    const canceledReturn = extractBillingReturnState(new URLSearchParams({
      reference: 'DCAU-123',
      cancelled: 'true',
    }));

    assert.notEqual(
      buildSubscriptionBootstrapKey('user-1', successReturn),
      buildSubscriptionBootstrapKey('user-1', canceledReturn),
    );
    assert.equal(buildSubscriptionBootstrapKey('', successReturn), null);
  });

  await run('meaningful usage data detection ignores empty payloads but accepts saved limits and usage rows', () => {
    assert.equal(hasMeaningfulSubscriptionUsageData({
      plan: null,
      limits: {},
      limitRules: {},
      usageByLimit: {},
    }), false);

    assert.equal(hasMeaningfulSubscriptionUsageData({
      plan: 'pro',
      limits: { max_uploads_total: 25 },
      limitRules: {},
      usageByLimit: {},
    }), true);

    assert.equal(hasMeaningfulSubscriptionUsageData({
      plan: 'pro',
      limits: {},
      limitRules: {},
      usageByLimit: {
        max_tokens_total: { used: '1200' },
      },
    }), true);
  });

  await run('subscription page no longer mounts its own billing realtime refresh loop', () => {
    const source = readProjectFile('src/app/dashboard/settings/subscription/page.tsx');

    assert.equal(source.includes("channel(`billing-status:${user.id}`)"), false);
    assert.equal(source.includes('buildSubscriptionBootstrapKey'), true);
    assert.equal(source.includes('refreshUsageSection'), true);
  });

  await run('usage page treats every enabled zero-cap allowance as blocked', () => {
    const source = readProjectFile('src/app/dashboard/settings/usage/page.tsx');

    assert.equal(source.includes("if (limit === null) return { percent: 0, label: 'Unlimited'"), true);
    assert.equal(source.includes("if (limit <= 0) return { percent: 100, label: 'Limit reached', level: 'blocked' as const };"), true);
    assert.equal(source.includes("{ percent: 0, label: 'Unavailable', level: 'normal' as const }"), false);
    assert.equal(source.includes("if ((row.limit || 0) <= 0) return sum + 100;"), true);
  });

  await run('usage page determines exhaustion before rounding display percentage', () => {
    const source = readProjectFile('src/app/dashboard/settings/usage/page.tsx');

    assert.equal(source.includes('const blocked = normalizedUsed >= limit;'), true);
    assert.equal(source.includes("if (blocked) return { percent, label: 'Limit reached', level: 'blocked' as const };"), true);
    assert.equal(source.includes("if (percent >= 100) return { percent, label: 'Limit reached', level: 'blocked' as const };"), false);
  });

  await run('usage page distinguishes disabled rules from unlimited allowances and excludes them from averages', () => {
    const source = readProjectFile('src/app/dashboard/settings/usage/page.tsx');

    assert.equal(source.includes("if (!enabled) return { percent: 0, label: 'Disabled', level: 'disabled' as const }"), true);
    assert.equal(source.includes("enabled: rule?.is_enabled !== false"), true);
    assert.equal(source.includes("'Not included in your current plan'"), true);
    assert.equal(source.includes("'This feature is currently unavailable on your plan.'"), true);
    assert.equal(source.includes("usageRows.filter((row) => row.enabled && row.limit !== null)"), true);
  });

  await run('usage rows normalize numeric strings, fall back to saved limits, and preserve unlimited rules', () => {
    const result = buildSubscriptionUsageRows({
      snapshot: { managedPlan: 'pro' },
      currentPlanManagedPlan: 'pro',
      tier: 'pro',
      usage: {
        plan: 'pro',
        limits: {
          max_uploads_total: 25,
        },
        limitRules: {
          max_uploads_total: {
            label: 'Uploads',
            presentation: {
              label: 'Saved uploads',
              reset_description: 'Resets every month',
            },
          },
          max_tokens_total: {
            label: 'Tokens',
            is_unlimited: true,
          },
        },
        usageByLimit: {
          max_uploads_total: {
            used: '9',
          },
          max_tokens_total: {
            used: '1450',
            limit: null,
            reset: {
              label: 'Unlimited',
            },
          },
        },
      },
    });

    assert.equal(result.planCode, 'pro');
    assert.equal(result.hasData, true);
    assert.deepEqual(result.resetSummary, ['Resets every month', 'Unlimited']);

    const uploadsRow = result.rows.find((row) => row.key === 'max_uploads_total');
    assert.deepEqual(uploadsRow, {
      key: 'max_uploads_total',
      label: 'Saved uploads',
      used: 9,
      limit: 25,
      resetText: 'Resets every month · 16 remaining · 36% used',
    });

    const unlimitedRow = result.rows.find((row) => row.key === 'max_tokens_total');
    assert.deepEqual(unlimitedRow, {
      key: 'max_tokens_total',
      label: 'Tokens',
      used: 1450,
      limit: null,
      resetText: 'Unlimited · Unlimited usage',
    });
  });

  await run('usage guidance becomes actionable near and at finite plan limits', () => {
    const result = buildSubscriptionUsageRows({
      snapshot: { managedPlan: 'pro' },
      currentPlanManagedPlan: 'pro',
      tier: 'pro',
      usage: {
        plan: 'pro',
        limits: {
          max_chats_total: 100,
          max_uploads_total: 100,
          max_exam_predictions: 100,
        },
        limitRules: {},
        usageByLimit: {
          max_chats_total: { used: 76, reset: { label: 'Resets monthly' } },
          max_uploads_total: { used: 92, reset: { label: 'Resets monthly' } },
          max_exam_predictions: { used: 100, reset: { label: 'Resets monthly' } },
        },
      },
    });

    assert.equal(
      result.rows.find((row) => row.key === 'max_chats_total')?.resetText,
      'Resets monthly · Approaching limit · 24 remaining · 76% used',
    );
    assert.equal(
      result.rows.find((row) => row.key === 'max_uploads_total')?.resetText,
      'Resets monthly · Almost at limit · 8 remaining · 92% used',
    );
    assert.equal(
      result.rows.find((row) => row.key === 'max_exam_predictions')?.resetText,
      'Resets monthly · Limit reached · 100% used',
    );
    assert.deepEqual(result.resetSummary, ['Resets monthly']);
  });

  await run('fallback labels and non-consumptive limits use plain-language guidance', () => {
    const result = buildSubscriptionUsageRows({
      snapshot: { managedPlan: 'pro' },
      currentPlanManagedPlan: 'pro',
      tier: 'pro',
      usage: {
        plan: 'pro',
        limits: {
          max_chats_total: 100,
          max_uploads_total: 25,
          max_tokens_total: 50000,
          max_file_size_mb: 50,
          max_concurrent_jobs: 3,
        },
        limitRules: {},
        usageByLimit: {
          max_chats_total: { used: 12 },
          max_uploads_total: { used: 4 },
          max_tokens_total: { used: 7500 },
          max_file_size_mb: { used: 0 },
          max_concurrent_jobs: { used: 1 },
        },
      },
    });

    assert.equal(result.rows.find((row) => row.key === 'max_chats_total')?.label, 'AI chats');
    assert.equal(result.rows.find((row) => row.key === 'max_uploads_total')?.label, 'Document uploads');
    assert.equal(result.rows.find((row) => row.key === 'max_tokens_total')?.label, 'AI tokens');

    const fileSizeRow = result.rows.find((row) => row.key === 'max_file_size_mb');
    assert.equal(fileSizeRow?.label, 'File size per upload');
    assert.equal(fileSizeRow?.resetText, 'Up to 50 MB per file');

    const concurrentJobsRow = result.rows.find((row) => row.key === 'max_concurrent_jobs');
    assert.equal(concurrentJobsRow?.label, 'Simultaneous processing jobs');
    assert.equal(concurrentJobsRow?.resetText, '1 of 3 processing slots active · 2 available');
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();