import assert from 'node:assert/strict';
import {
  normalizeAccountSnapshotPayload,
  readPersistedAccountSnapshotSync,
  resolveCachedAccountSnapshotFallback,
  writePersistedAccountSnapshotSync,
} from '../src/lib/account/account-snapshot-cache.js';
import { resolveDisplayedPlanCode } from '../src/lib/billing/plan-refresh-state.js';

let failed = 0;

type SyncOrAsyncTest = () => void | Promise<void>;

async function run(name: string, fn: SyncOrAsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

type StorageMap = Map<string, string>;

function installWindowStorage() {
  const store: StorageMap = new Map();
  const localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };

  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = { localStorage };

  return () => {
    if (previousWindow === undefined) {
      delete (globalThis as any).window;
      return;
    }
    (globalThis as any).window = previousWindow;
  };
}

function buildAccountPayload(input: {
  plan: 'free' | 'pro';
  activePlanKey: string | null;
  subscriptionStatus: string | null;
  entitlementSource: 'paid' | 'none';
  validatedAt: string;
}) {
  return {
    userId: 'user-1',
    validatedAt: input.validatedAt,
    plan: input.plan,
    effectivePlan: {
      plan: input.plan,
      isAdmin: false,
      hasPro: input.plan !== 'free',
      source: input.plan === 'free' ? 'default' : 'billing',
      entitlementSource: input.entitlementSource,
      expiresAt: input.plan === 'free' ? null : '2026-04-30T00:00:00.000Z',
    },
    entitlements: {
      userId: 'user-1',
      plan: input.plan,
      hasPro: input.plan !== 'free',
      entitlementSource: input.entitlementSource,
      entitlementEndsAt: input.plan === 'free' ? null : '2026-04-30T00:00:00.000Z',
      billingEnabled: true,
      promoEnabled: false,
      promoActive: false,
      canAccessBilling: true,
      promoBannerEnabled: false,
      promoContentConfig: {},
      promoEndsAtUtc: null,
      promoEndsAtLagos: null,
      retentionDays: input.plan === 'free' ? 14 : 30,
      asOf: input.validatedAt,
      source: 'account_snapshot_test',
    },
    currentPlan: {
      managedPlan: input.plan,
      effectivePlan: input.plan,
      entitlementSource: input.entitlementSource,
      promoActive: false,
      activePlanKey: input.activePlanKey,
      subscriptionStatus: input.subscriptionStatus,
    },
    planSnapshot: {
      checksum: input.plan === 'free' ? 'plan:free:v1' : 'plan:pro:v2',
      issuedAt: input.validatedAt,
      managedPlan: input.plan,
      activePlanKey: input.activePlanKey,
      entitlementSource: input.entitlementSource,
      expiresAt: input.plan === 'free' ? null : '2026-04-30T00:00:00.000Z',
      hasPaidEntitlement: input.plan !== 'free',
    },
    limits: {
      max_chats_total: input.plan === 'free' ? 100 : 30000,
    },
    limitRules: {},
    usage: {
      today: { max_chats_total: 12 },
      total: { max_chats_total: 12 },
      byLimit: {},
      windows: {},
      resetPolicies: {},
      resetAt: null,
    },
    subscription: input.activePlanKey
      ? {
          planKey: input.activePlanKey,
          status: input.subscriptionStatus,
          startsAt: '2026-03-01T00:00:00.000Z',
          endsAt: input.plan === 'free' ? null : '2026-04-30T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          updatedAt: input.validatedAt,
        }
      : null,
  };
}

async function main() {
  await run('PRO snapshot persists across refresh and restores as PRO before any revalidation', () => {
    const restoreWindow = installWindowStorage();
    try {
      const normalized = normalizeAccountSnapshotPayload(
        buildAccountPayload({
          plan: 'pro',
          activePlanKey: 'pro_monthly',
          subscriptionStatus: 'active',
          entitlementSource: 'paid',
          validatedAt: '2026-03-21T10:00:00.000Z',
        }),
        'user-1',
      );
      assert.ok(normalized);

      writePersistedAccountSnapshotSync(normalized, 1711015200000);
      const restored = readPersistedAccountSnapshotSync('user-1');

      assert.ok(restored.snapshot);
      assert.equal(restored.snapshot?.plan, 'pro');
      assert.equal(restored.snapshot?.effectivePlan.plan, 'pro');
      assert.equal(restored.snapshot?.currentPlan.managedPlan, 'pro');
      assert.equal(restored.snapshot?.planSnapshot?.managedPlan, 'pro');
    } finally {
      restoreWindow();
    }
  });

  await run('offline or fetch failure keeps the last known PRO snapshot instead of downgrading to free', () => {
    const proSnapshot = normalizeAccountSnapshotPayload(
      buildAccountPayload({
        plan: 'pro',
        activePlanKey: 'pro_monthly',
        subscriptionStatus: 'active',
        entitlementSource: 'paid',
        validatedAt: '2026-03-21T10:00:00.000Z',
      }),
      'user-1',
    );
    assert.ok(proSnapshot);

    const fallback = resolveCachedAccountSnapshotFallback({
      cachedSnapshot: null,
      cachedAt: null,
      previousSnapshot: proSnapshot,
      previousCachedAt: 1711015200000,
    });

    assert.ok(fallback.snapshot);
    assert.equal(fallback.snapshot?.plan, 'pro');
    assert.equal(fallback.snapshot?.currentPlan.managedPlan, 'pro');
    assert.equal(fallback.fromCache, true);
  });

  await run('downgrade to free only happens when the server snapshot explicitly says free', () => {
    const proSnapshot = normalizeAccountSnapshotPayload(
      buildAccountPayload({
        plan: 'pro',
        activePlanKey: 'pro_monthly',
        subscriptionStatus: 'active',
        entitlementSource: 'paid',
        validatedAt: '2026-03-21T10:00:00.000Z',
      }),
      'user-1',
    );
    const freeSnapshot = normalizeAccountSnapshotPayload(
      buildAccountPayload({
        plan: 'free',
        activePlanKey: null,
        subscriptionStatus: null,
        entitlementSource: 'none',
        validatedAt: '2026-03-22T10:00:00.000Z',
      }),
      'user-1',
    );
    assert.ok(proSnapshot);
    assert.ok(freeSnapshot);

    const fallbackWithPreviousOnly = resolveCachedAccountSnapshotFallback({
      cachedSnapshot: null,
      cachedAt: null,
      previousSnapshot: proSnapshot,
    });
    assert.equal(fallbackWithPreviousOnly.snapshot?.plan, 'pro');

    const authoritativeDowngrade = resolveCachedAccountSnapshotFallback({
      cachedSnapshot: freeSnapshot,
      cachedAt: 1711101600000,
      previousSnapshot: proSnapshot,
      previousCachedAt: 1711015200000,
    });
    assert.equal(authoritativeDowngrade.snapshot?.plan, 'free');
    assert.equal(authoritativeDowngrade.snapshot?.currentPlan.managedPlan, 'free');
  });

  await run('cache miss stays unknown at the billing-page display layer instead of manufacturing free', () => {
    assert.equal(
      resolveDisplayedPlanCode({
        snapshot: null,
        currentPlanManagedPlan: null,
        tier: null,
        limitsUsagePlan: null,
      }),
      null,
    );
  });

  await run('partial snapshot payloads without canonical plan authority are rejected instead of normalized to free', () => {
    assert.equal(
      normalizeAccountSnapshotPayload(
        {
          userId: 'user-1',
          entitlements: {},
          currentPlan: {},
          effectivePlan: {},
        },
        'user-1',
      ),
      null,
    );
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
