"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const account_snapshot_cache_js_1 = require("../src/lib/account/account-snapshot-cache.js");
const plan_refresh_state_js_1 = require("../src/lib/billing/plan-refresh-state.js");
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
function installWindowStorage() {
    const store = new Map();
    const localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => {
            store.set(key, value);
        },
        removeItem: (key) => {
            store.delete(key);
        },
    };
    const previousWindow = globalThis.window;
    globalThis.window = { localStorage };
    return () => {
        if (previousWindow === undefined) {
            delete globalThis.window;
            return;
        }
        globalThis.window = previousWindow;
    };
}
function buildAccountPayload(input) {
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
            const normalized = (0, account_snapshot_cache_js_1.normalizeAccountSnapshotPayload)(buildAccountPayload({
                plan: 'pro',
                activePlanKey: 'pro_monthly',
                subscriptionStatus: 'active',
                entitlementSource: 'paid',
                validatedAt: '2026-03-21T10:00:00.000Z',
            }), 'user-1');
            strict_1.default.ok(normalized);
            (0, account_snapshot_cache_js_1.writePersistedAccountSnapshotSync)(normalized, 1711015200000);
            const restored = (0, account_snapshot_cache_js_1.readPersistedAccountSnapshotSync)('user-1');
            strict_1.default.ok(restored.snapshot);
            strict_1.default.equal(restored.snapshot?.plan, 'pro');
            strict_1.default.equal(restored.snapshot?.effectivePlan.plan, 'pro');
            strict_1.default.equal(restored.snapshot?.currentPlan.managedPlan, 'pro');
            strict_1.default.equal(restored.snapshot?.planSnapshot?.managedPlan, 'pro');
        }
        finally {
            restoreWindow();
        }
    });
    await run('offline or fetch failure keeps the last known PRO snapshot instead of downgrading to free', () => {
        const proSnapshot = (0, account_snapshot_cache_js_1.normalizeAccountSnapshotPayload)(buildAccountPayload({
            plan: 'pro',
            activePlanKey: 'pro_monthly',
            subscriptionStatus: 'active',
            entitlementSource: 'paid',
            validatedAt: '2026-03-21T10:00:00.000Z',
        }), 'user-1');
        strict_1.default.ok(proSnapshot);
        const fallback = (0, account_snapshot_cache_js_1.resolveCachedAccountSnapshotFallback)({
            cachedSnapshot: null,
            cachedAt: null,
            previousSnapshot: proSnapshot,
            previousCachedAt: 1711015200000,
        });
        strict_1.default.ok(fallback.snapshot);
        strict_1.default.equal(fallback.snapshot?.plan, 'pro');
        strict_1.default.equal(fallback.snapshot?.currentPlan.managedPlan, 'pro');
        strict_1.default.equal(fallback.fromCache, true);
    });
    await run('downgrade to free only happens when the server snapshot explicitly says free', () => {
        const proSnapshot = (0, account_snapshot_cache_js_1.normalizeAccountSnapshotPayload)(buildAccountPayload({
            plan: 'pro',
            activePlanKey: 'pro_monthly',
            subscriptionStatus: 'active',
            entitlementSource: 'paid',
            validatedAt: '2026-03-21T10:00:00.000Z',
        }), 'user-1');
        const freeSnapshot = (0, account_snapshot_cache_js_1.normalizeAccountSnapshotPayload)(buildAccountPayload({
            plan: 'free',
            activePlanKey: null,
            subscriptionStatus: null,
            entitlementSource: 'none',
            validatedAt: '2026-03-22T10:00:00.000Z',
        }), 'user-1');
        strict_1.default.ok(proSnapshot);
        strict_1.default.ok(freeSnapshot);
        const fallbackWithPreviousOnly = (0, account_snapshot_cache_js_1.resolveCachedAccountSnapshotFallback)({
            cachedSnapshot: null,
            cachedAt: null,
            previousSnapshot: proSnapshot,
        });
        strict_1.default.equal(fallbackWithPreviousOnly.snapshot?.plan, 'pro');
        const authoritativeDowngrade = (0, account_snapshot_cache_js_1.resolveCachedAccountSnapshotFallback)({
            cachedSnapshot: freeSnapshot,
            cachedAt: 1711101600000,
            previousSnapshot: proSnapshot,
            previousCachedAt: 1711015200000,
        });
        strict_1.default.equal(authoritativeDowngrade.snapshot?.plan, 'free');
        strict_1.default.equal(authoritativeDowngrade.snapshot?.currentPlan.managedPlan, 'free');
    });
    await run('cache miss stays unknown at the billing-page display layer instead of manufacturing free', () => {
        strict_1.default.equal((0, plan_refresh_state_js_1.resolveDisplayedPlanCode)({
            snapshot: null,
            currentPlanManagedPlan: null,
            tier: null,
            limitsUsagePlan: null,
        }), null);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
