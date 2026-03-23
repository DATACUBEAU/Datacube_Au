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
      resetText: 'Resets every month',
    });

    const unlimitedRow = result.rows.find((row) => row.key === 'max_tokens_total');
    assert.deepEqual(unlimitedRow, {
      key: 'max_tokens_total',
      label: 'Tokens',
      used: 1450,
      limit: null,
      resetText: 'Unlimited',
    });
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
