import assert from 'node:assert/strict';
import { deriveNormalizedSubscriptionState } from '../src/lib/billing/subscription-state.js';
import {
  classifyAccountSnapshotFailure,
  resolveBootstrapAccountSnapshotState,
  resolveFailedAccountSnapshotState,
  resolveSuccessfulAccountSnapshotState,
} from '../src/lib/account/account-snapshot-state.js';
import { resolveDisplayedPlanCode } from '../src/lib/billing/plan-refresh-state.js';

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

function createSnapshot(plan: 'free' | 'pro') {
  const entitlementSource = plan === 'free' ? 'none' : 'paid';
  const effectiveEntitlementPlan = plan === 'free' ? 'free' : 'pro';
  const validatedAt = plan === 'free' ? '2026-03-21T08:10:00.000Z' : '2026-03-21T08:05:00.000Z';
  const currentPlan = deriveNormalizedSubscriptionState({
    effectivePlan: effectiveEntitlementPlan,
    entitlementSource,
    legacyTier: plan,
    subscriptionPlanKey: plan === 'free' ? null : 'pro_monthly',
    subscriptionStatus: plan === 'free' ? null : 'active',
    latestPaymentPlanKey: plan === 'free' ? null : 'pro_monthly',
  });

  return {
    userId: 'user-1',
    validatedAt,
    plan,
    effectivePlan: {
      plan,
      isAdmin: false,
      hasPro: plan !== 'free',
      source: 'account_snapshot',
      entitlementSource,
      expiresAt: null,
    },
    entitlements: {
      userId: 'user-1',
      plan: effectiveEntitlementPlan,
      hasPro: plan !== 'free',
      entitlementSource,
      entitlementEndsAt: null,
      billingEnabled: plan !== 'free',
      promoEnabled: false,
      promoActive: false,
      canAccessBilling: plan !== 'free',
      promoBannerEnabled: false,
      promoContentConfig: {},
      promoEndsAtUtc: null,
      promoEndsAtLagos: null,
      retentionDays: plan === 'free' ? 14 : 30,
      asOf: validatedAt,
      source: 'account_snapshot',
    },
    currentPlan,
    planSnapshot: {
      checksum: `checksum:${plan}`,
      issuedAt: validatedAt,
      managedPlan: currentPlan.managedPlan,
      activePlanKey: currentPlan.activePlanKey,
      entitlementSource,
      expiresAt: null,
      hasPaidEntitlement: plan !== 'free',
    },
    limits: {},
    limitRules: {},
    usage: {
      today: {},
      total: {},
      byLimit: {},
      windows: {},
      resetPolicies: {},
      resetAt: null,
    },
    subscription:
      plan === 'free'
        ? null
        : {
            planKey: 'pro_monthly',
            status: 'active',
            startsAt: '2026-03-01T00:00:00.000Z',
            endsAt: '2026-04-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
            updatedAt: validatedAt,
          },
  };
}

async function main() {
  await run('refresh bootstrap restores the cached PRO snapshot immediately', () => {
    const snapshot = createSnapshot('pro');
    const state = resolveBootstrapAccountSnapshotState(snapshot, 1711000000000);
    assert.equal(state.snapshot?.plan, 'pro');
    assert.equal(state.loading, false);
    assert.equal(state.isUsingCachedData, true);
    assert.equal(state.cachedAt, 1711000000000);
  });

  await run('offline failures keep the last valid PRO snapshot instead of downgrading', () => {
    const snapshot = createSnapshot('pro');
    const state = resolveFailedAccountSnapshotState({
      error: { name: 'OfflineError', message: 'You are offline' },
      cachedSnapshot: null,
      cachedAt: null,
      currentSnapshot: snapshot,
      currentCachedAt: 1711000000000,
    });
    assert.equal(state.reason, 'offline');
    assert.equal(state.snapshot?.plan, 'pro');
    assert.equal(state.isUsingCachedData, true);
    assert.equal(state.clearPersistedSnapshot, false);
  });

  await run('network and timeout failures do not silently turn PRO into FREE', () => {
    const snapshot = createSnapshot('pro');
    const timeoutState = resolveFailedAccountSnapshotState({
      error: new Error('Request timed out'),
      cachedSnapshot: null,
      cachedAt: null,
      currentSnapshot: snapshot,
      currentCachedAt: 1711000000000,
    });
    const networkState = resolveFailedAccountSnapshotState({
      error: new Error('Failed to fetch'),
      cachedSnapshot: null,
      cachedAt: null,
      currentSnapshot: snapshot,
      currentCachedAt: 1711000000000,
    });

    assert.equal(timeoutState.reason, 'timeout');
    assert.equal(timeoutState.snapshot?.plan, 'pro');
    assert.equal(networkState.reason, 'network');
    assert.equal(networkState.snapshot?.plan, 'pro');
  });

  await run('expired or unauthorized sessions clear the cached plan snapshot instead of treating it as offline', () => {
    const snapshot = createSnapshot('pro');
    const state = resolveFailedAccountSnapshotState({
      error: { status: 401, message: 'unauthorized' },
      cachedSnapshot: snapshot,
      cachedAt: 1711000000000,
      currentSnapshot: snapshot,
      currentCachedAt: 1711000000000,
    });
    assert.equal(state.reason, 'unauthorized');
    assert.equal(state.snapshot, null);
    assert.equal(state.clearPersistedSnapshot, true);
  });

  await run('reconnect applies the latest backend snapshot and only downgrades when the server says free', () => {
    const proSnapshot = createSnapshot('pro');
    const freeSnapshot = createSnapshot('free');
    const proState = resolveSuccessfulAccountSnapshotState(proSnapshot, 1711000000000);
    const downgradedState = resolveSuccessfulAccountSnapshotState(freeSnapshot, 1711003600000);

    assert.equal(proState.snapshot.plan, 'pro');
    assert.equal(downgradedState.snapshot.plan, 'free');
    assert.equal(downgradedState.isUsingCachedData, false);
  });

  await run('missing authoritative plan inputs stay unknown instead of flashing free', () => {
    assert.equal(
      resolveDisplayedPlanCode({
        snapshot: null,
        currentPlanManagedPlan: null,
        tier: null,
        limitsUsagePlan: null,
      }),
      null,
    );
    assert.equal(classifyAccountSnapshotFailure({ status: 403, message: 'forbidden' }), 'forbidden');
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
