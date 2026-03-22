"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_SNAPSHOT_CACHE_TTL_MS = exports.ACCOUNT_SNAPSHOT_CACHE_SCHEMA = exports.ACCOUNT_SNAPSHOT_SOURCE = exports.ACCOUNT_SNAPSHOT_LEGACY_ROUTE = exports.ACCOUNT_SNAPSHOT_ROUTE = void 0;
exports.buildUnknownAccountEntitlements = buildUnknownAccountEntitlements;
exports.normalizeAccountSnapshotPayload = normalizeAccountSnapshotPayload;
exports.resolveCachedAccountSnapshotFallback = resolveCachedAccountSnapshotFallback;
exports.readPersistedAccountSnapshotSync = readPersistedAccountSnapshotSync;
exports.writePersistedAccountSnapshotSync = writePersistedAccountSnapshotSync;
exports.clearPersistedAccountSnapshotSync = clearPersistedAccountSnapshotSync;
const plans_1 = require("../billing/plans");
const subscription_state_1 = require("../billing/subscription-state");
const subscription_policy_1 = require("../plans/subscription-policy");
exports.ACCOUNT_SNAPSHOT_ROUTE = '/account/effective';
exports.ACCOUNT_SNAPSHOT_LEGACY_ROUTE = '/account/snapshot';
exports.ACCOUNT_SNAPSHOT_SOURCE = 'account-snapshot';
exports.ACCOUNT_SNAPSHOT_CACHE_SCHEMA = 1;
exports.ACCOUNT_SNAPSHOT_CACHE_TTL_MS = 1000 * 60 * 30;
const ACCOUNT_SNAPSHOT_STORAGE_PREFIX = 'dcau:account-snapshot';
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function asString(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}
function asNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function normalizeNumberMap(value) {
    const map = asRecord(value);
    return Object.entries(map).reduce((acc, [key, raw]) => {
        const parsed = Number(raw);
        if (Number.isFinite(parsed))
            acc[key] = parsed;
        return acc;
    }, {});
}
function normalizeStringMap(value) {
    const map = asRecord(value);
    return Object.entries(map).reduce((acc, [key, raw]) => {
        if (typeof raw === 'string' && raw.trim()) {
            acc[key] = raw;
        }
        return acc;
    }, {});
}
function normalizeObjectMap(value) {
    const map = asRecord(value);
    return Object.entries(map).reduce((acc, [key, raw]) => {
        acc[key] = asRecord(raw);
        return acc;
    }, {});
}
function normalizeWindowMap(value) {
    const map = asRecord(value);
    return Object.entries(map).reduce((acc, [key, raw]) => {
        const entry = asRecord(raw);
        acc[key] = {
            label: typeof entry.label === 'string' ? entry.label : '',
            policy: typeof entry.policy === 'string' ? entry.policy : '',
            interval_value: Number.isFinite(Number(entry.intervalValue ?? entry.interval_value))
                ? Number(entry.intervalValue ?? entry.interval_value)
                : null,
            interval_unit: typeof entry.intervalUnit === 'string'
                ? entry.intervalUnit
                : (typeof entry.interval_unit === 'string' ? entry.interval_unit : null),
            window_start: typeof entry.window_start === 'string' ? entry.window_start : '',
            window_end: typeof entry.window_end === 'string' ? entry.window_end : null,
        };
        return acc;
    }, {});
}
function buildUnknownAccountEntitlements(userId) {
    return {
        userId: userId || null,
        plan: 'unknown',
        hasPro: false,
        entitlementSource: 'none',
        entitlementEndsAt: null,
        billingEnabled: false,
        promoEnabled: false,
        promoActive: false,
        canAccessBilling: false,
        promoBannerEnabled: false,
        promoContentConfig: {},
        promoEndsAtUtc: null,
        promoEndsAtLagos: null,
        retentionDays: subscription_policy_1.FREE_PLAN_EXPIRATION_DAYS,
        asOf: null,
        source: 'unknown',
    };
}
function normalizeEntitlements(value, fallbackUserId) {
    const row = asRecord(value);
    const plan = (() => {
        const rawPlan = asString(row.plan);
        return rawPlan ? (0, plans_1.normalizeEffectiveEntitlementPlan)(rawPlan) : 'unknown';
    })();
    const entitlementSource = (0, plans_1.normalizeBillingEntitlementSource)(row.entitlementSource);
    const promoActive = row.promoActive === true;
    return {
        userId: asString(row.userId) || fallbackUserId,
        plan,
        hasPro: row.hasPro === true ||
            plan === 'admin' ||
            plan === 'premium' ||
            plan === 'promo_pro' ||
            promoActive ||
            (plan === 'pro' && entitlementSource !== 'none'),
        entitlementSource,
        entitlementEndsAt: asString(row.entitlementEndsAt),
        billingEnabled: row.billingEnabled === true,
        promoEnabled: row.promoEnabled === true,
        promoActive,
        canAccessBilling: row.canAccessBilling === true,
        promoBannerEnabled: row.promoBannerEnabled === true,
        promoContentConfig: asRecord(row.promoContentConfig),
        promoEndsAtUtc: asString(row.promoEndsAtUtc),
        promoEndsAtLagos: asString(row.promoEndsAtLagos),
        retentionDays: Math.max(1, Math.floor(asNumber(row.retentionDays, subscription_policy_1.FREE_PLAN_EXPIRATION_DAYS))),
        asOf: asString(row.asOf),
        source: asString(row.source) || 'api',
    };
}
function normalizePlanSnapshot(value) {
    const row = asRecord(value);
    if (Object.keys(row).length === 0)
        return null;
    return {
        userId: asString(row.userId),
        managedPlan: asString(row.managedPlan),
        activePlanKey: asString(row.activePlanKey),
        entitlementSource: asString(row.entitlementSource),
        expiresAt: asString(row.expiresAt),
        hasPaidEntitlement: row.hasPaidEntitlement === true,
        checksum: asString(row.checksum),
        issuedAt: asString(row.issuedAt),
    };
}
function normalizeCurrentPlan(value, entitlements, fallbackPlan) {
    const row = asRecord(value);
    return (0, subscription_state_1.deriveNormalizedSubscriptionState)({
        effectivePlan: row.effectivePlan ?? entitlements.plan ?? fallbackPlan,
        entitlementSource: row.entitlementSource ?? entitlements.entitlementSource,
        promoActive: row.promoActive === true
            ? true
            : (row.promoActive === false ? false : entitlements.promoActive),
        subscriptionPlanKey: row.activePlanKey,
        subscriptionStatus: row.subscriptionStatus,
        latestPaymentPlanKey: row.activePlanKey,
        legacyTier: row.managedPlan ?? fallbackPlan ?? entitlements.plan,
    });
}
function accountSnapshotStorageKey(userId) {
    return `${ACCOUNT_SNAPSHOT_STORAGE_PREFIX}:${userId}`;
}
function normalizeAccountSnapshotPayload(payload, fallbackUserId) {
    const root = asRecord(asRecord(payload).snapshot ?? payload);
    const userId = asString(root.userId) || fallbackUserId || null;
    if (!userId)
        return null;
    const entitlements = normalizeEntitlements(root.entitlements, userId);
    const validatedAt = asString(root.validatedAt) ||
        entitlements.asOf ||
        asString(asRecord(root.planSnapshot).issuedAt);
    const effectivePlanRow = asRecord(root.effectivePlan);
    const plan = asString(root.plan) ||
        asString(effectivePlanRow.plan) ||
        (entitlements.plan !== 'unknown' ? entitlements.plan : null);
    if (!plan)
        return null;
    const currentPlan = normalizeCurrentPlan(root.currentPlan, entitlements, plan);
    return {
        userId,
        validatedAt,
        plan,
        effectivePlan: {
            plan: asString(effectivePlanRow.plan) || plan,
            isAdmin: effectivePlanRow.isAdmin === true,
            hasPro: effectivePlanRow.hasPro === true || plan !== 'free',
            source: asString(effectivePlanRow.source) || 'api',
            entitlementSource: (0, plans_1.normalizeBillingEntitlementSource)(effectivePlanRow.entitlementSource),
            expiresAt: asString(effectivePlanRow.expiresAt),
        },
        entitlements,
        currentPlan,
        planSnapshot: normalizePlanSnapshot(root.planSnapshot),
        limits: normalizeNumberMap(root.limits),
        limitRules: normalizeObjectMap(root.limitRules),
        usage: {
            today: normalizeNumberMap(asRecord(root.usage).today),
            total: normalizeNumberMap(asRecord(root.usage).total),
            byLimit: normalizeObjectMap(asRecord(root.usage).byLimit),
            windows: normalizeWindowMap(asRecord(root.usage).windows),
            resetPolicies: normalizeStringMap(asRecord(root.usage).resetPolicies),
            resetAt: asString(asRecord(root.usage).resetAt),
        },
        subscription: (() => {
            const row = asRecord(root.subscription);
            if (Object.keys(row).length === 0)
                return null;
            return {
                planKey: asString(row.planKey),
                status: asString(row.status),
                startsAt: asString(row.startsAt),
                endsAt: asString(row.endsAt),
                cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
                updatedAt: asString(row.updatedAt),
            };
        })(),
    };
}
function resolveCachedAccountSnapshotFallback(input) {
    if (input.cachedSnapshot) {
        return {
            snapshot: input.cachedSnapshot,
            cachedAt: input.cachedAt,
            fromCache: true,
        };
    }
    if (input.previousSnapshot) {
        return {
            snapshot: input.previousSnapshot,
            cachedAt: input.previousCachedAt ?? input.cachedAt ?? null,
            fromCache: true,
        };
    }
    return {
        snapshot: null,
        cachedAt: null,
        fromCache: false,
    };
}
function readPersistedAccountSnapshotSync(userId) {
    if (!userId || typeof window === 'undefined') {
        return { snapshot: null, cachedAt: null };
    }
    try {
        const raw = window.localStorage.getItem(accountSnapshotStorageKey(userId));
        if (!raw)
            return { snapshot: null, cachedAt: null };
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.schemaVersion !== exports.ACCOUNT_SNAPSHOT_CACHE_SCHEMA) {
            return { snapshot: null, cachedAt: null };
        }
        const snapshot = normalizeAccountSnapshotPayload(parsed.snapshot, userId);
        if (!snapshot)
            return { snapshot: null, cachedAt: null };
        return {
            snapshot,
            cachedAt: Number.isFinite(Number(parsed.cachedAt)) ? Number(parsed.cachedAt) : null,
        };
    }
    catch {
        return { snapshot: null, cachedAt: null };
    }
}
function writePersistedAccountSnapshotSync(snapshot, cachedAt) {
    if (!snapshot.userId || typeof window === 'undefined')
        return;
    try {
        const envelope = {
            schemaVersion: exports.ACCOUNT_SNAPSHOT_CACHE_SCHEMA,
            cachedAt,
            snapshot,
        };
        window.localStorage.setItem(accountSnapshotStorageKey(snapshot.userId), JSON.stringify(envelope));
    }
    catch {
        // Ignore storage failures; IndexedDB/user-cache remains the primary store.
    }
}
function clearPersistedAccountSnapshotSync(userId) {
    if (!userId || typeof window === 'undefined')
        return;
    try {
        window.localStorage.removeItem(accountSnapshotStorageKey(userId));
    }
    catch {
        // Ignore storage cleanup failures.
    }
}
