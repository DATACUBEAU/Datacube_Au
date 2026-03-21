"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const subscription_state_js_1 = require("../src/lib/billing/subscription-state.js");
const account_snapshot_state_js_1 = require("../src/lib/account/account-snapshot-state.js");
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
function createSnapshot(plan) {
    const entitlementSource = plan === 'free' ? 'none' : 'paid';
    const effectiveEntitlementPlan = plan === 'free' ? 'free' : 'pro';
    const validatedAt = plan === 'free' ? '2026-03-21T08:10:00.000Z' : '2026-03-21T08:05:00.000Z';
    const currentPlan = (0, subscription_state_js_1.deriveNormalizedSubscriptionState)({
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
        subscription: plan === 'free'
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
        const state = (0, account_snapshot_state_js_1.resolveBootstrapAccountSnapshotState)(snapshot, 1711000000000);
        strict_1.default.equal(state.snapshot?.plan, 'pro');
        strict_1.default.equal(state.loading, false);
        strict_1.default.equal(state.isUsingCachedData, true);
        strict_1.default.equal(state.cachedAt, 1711000000000);
    });
    await run('offline failures keep the last valid PRO snapshot instead of downgrading', () => {
        const snapshot = createSnapshot('pro');
        const state = (0, account_snapshot_state_js_1.resolveFailedAccountSnapshotState)({
            error: { name: 'OfflineError', message: 'You are offline' },
            cachedSnapshot: null,
            cachedAt: null,
            currentSnapshot: snapshot,
            currentCachedAt: 1711000000000,
        });
        strict_1.default.equal(state.reason, 'offline');
        strict_1.default.equal(state.snapshot?.plan, 'pro');
        strict_1.default.equal(state.isUsingCachedData, true);
        strict_1.default.equal(state.clearPersistedSnapshot, false);
    });
    await run('network and timeout failures do not silently turn PRO into FREE', () => {
        const snapshot = createSnapshot('pro');
        const timeoutState = (0, account_snapshot_state_js_1.resolveFailedAccountSnapshotState)({
            error: new Error('Request timed out'),
            cachedSnapshot: null,
            cachedAt: null,
            currentSnapshot: snapshot,
            currentCachedAt: 1711000000000,
        });
        const networkState = (0, account_snapshot_state_js_1.resolveFailedAccountSnapshotState)({
            error: new Error('Failed to fetch'),
            cachedSnapshot: null,
            cachedAt: null,
            currentSnapshot: snapshot,
            currentCachedAt: 1711000000000,
        });
        strict_1.default.equal(timeoutState.reason, 'timeout');
        strict_1.default.equal(timeoutState.snapshot?.plan, 'pro');
        strict_1.default.equal(networkState.reason, 'network');
        strict_1.default.equal(networkState.snapshot?.plan, 'pro');
    });
    await run('expired or unauthorized sessions clear the cached plan snapshot instead of treating it as offline', () => {
        const snapshot = createSnapshot('pro');
        const state = (0, account_snapshot_state_js_1.resolveFailedAccountSnapshotState)({
            error: { status: 401, message: 'unauthorized' },
            cachedSnapshot: snapshot,
            cachedAt: 1711000000000,
            currentSnapshot: snapshot,
            currentCachedAt: 1711000000000,
        });
        strict_1.default.equal(state.reason, 'unauthorized');
        strict_1.default.equal(state.snapshot, null);
        strict_1.default.equal(state.clearPersistedSnapshot, true);
    });
    await run('reconnect applies the latest backend snapshot and only downgrades when the server says free', () => {
        const proSnapshot = createSnapshot('pro');
        const freeSnapshot = createSnapshot('free');
        const proState = (0, account_snapshot_state_js_1.resolveSuccessfulAccountSnapshotState)(proSnapshot, 1711000000000);
        const downgradedState = (0, account_snapshot_state_js_1.resolveSuccessfulAccountSnapshotState)(freeSnapshot, 1711003600000);
        strict_1.default.equal(proState.snapshot.plan, 'pro');
        strict_1.default.equal(downgradedState.snapshot.plan, 'free');
        strict_1.default.equal(downgradedState.isUsingCachedData, false);
    });
    await run('missing authoritative plan inputs stay unknown instead of flashing free', () => {
        strict_1.default.equal((0, plan_refresh_state_js_1.resolveDisplayedPlanCode)({
            snapshot: null,
            currentPlanManagedPlan: null,
            tier: null,
            limitsUsagePlan: null,
        }), null);
        strict_1.default.equal((0, account_snapshot_state_js_1.classifyAccountSnapshotFailure)({ status: 403, message: 'forbidden' }), 'forbidden');
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
