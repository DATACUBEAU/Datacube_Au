import {
  normalizeBillingEntitlementSource,
  normalizeEffectiveEntitlementPlan,
} from '../billing/plans';
import {
  deriveNormalizedSubscriptionState,
  type NormalizedSubscriptionState,
} from '../billing/subscription-state';
import { FREE_PLAN_EXPIRATION_DAYS } from '../plans/subscription-policy';

export type AccountPlanSnapshot = {
  userId?: string | null;
  managedPlan?: string | null;
  activePlanKey?: string | null;
  entitlementSource?: string | null;
  expiresAt?: string | null;
  hasPaidEntitlement?: boolean;
  checksum?: string | null;
  issuedAt?: string | null;
};

export type AccountEntitlementsSnapshot = {
  userId: string | null;
  plan: 'unknown' | 'free' | 'pro' | 'promo_pro' | 'premium' | 'admin';
  hasPro: boolean;
  entitlementSource: 'paid' | 'promo' | 'none';
  entitlementEndsAt: string | null;
  billingEnabled: boolean;
  promoEnabled: boolean;
  promoActive: boolean;
  canAccessBilling: boolean;
  promoBannerEnabled: boolean;
  promoContentConfig: Record<string, unknown>;
  promoEndsAtUtc: string | null;
  promoEndsAtLagos: string | null;
  retentionDays: number;
  asOf: string | null;
  source: string;
};

export type AccountUsageWindow = {
  label: string;
  policy: string;
  interval_value: number | null;
  interval_unit: string | null;
  window_start: string;
  window_end: string | null;
};

export type AccountUsageSnapshot = {
  today: Record<string, number>;
  total: Record<string, number>;
  byLimit: Record<string, Record<string, unknown>>;
  windows: Record<string, AccountUsageWindow>;
  resetPolicies: Record<string, string>;
  resetAt: string | null;
};

export type PersistedCanonicalAccountSnapshot = {
  userId: string;
  validatedAt: string | null;
  plan: string;
  effectivePlan: {
    plan: string;
    isAdmin: boolean;
    hasPro: boolean;
    source: string;
    entitlementSource: AccountEntitlementsSnapshot['entitlementSource'];
    expiresAt: string | null;
  };
  entitlements: AccountEntitlementsSnapshot;
  currentPlan: NormalizedSubscriptionState;
  planSnapshot: AccountPlanSnapshot | null;
  limits: Record<string, number>;
  limitRules: Record<string, Record<string, unknown>>;
  usage: AccountUsageSnapshot;
  subscription: {
    planKey: string | null;
    status: string | null;
    startsAt: string | null;
    endsAt: string | null;
    cancelAtPeriodEnd: boolean;
    updatedAt: string | null;
  } | null;
};

type PersistedAccountSnapshotEnvelope = {
  schemaVersion: number;
  cachedAt: number;
  snapshot: PersistedCanonicalAccountSnapshot;
};

export type CachedAccountSnapshotFallback = {
  snapshot: PersistedCanonicalAccountSnapshot | null;
  cachedAt: number | null;
  fromCache: boolean;
};

export const ACCOUNT_SNAPSHOT_ROUTE = '/account/effective';
export const ACCOUNT_SNAPSHOT_LEGACY_ROUTE = '/account/snapshot';
export const ACCOUNT_SNAPSHOT_SOURCE = 'account-snapshot';
export const ACCOUNT_SNAPSHOT_CACHE_SCHEMA = 1;
export const ACCOUNT_SNAPSHOT_CACHE_TTL_MS = 1000 * 60 * 30;

const ACCOUNT_SNAPSHOT_STORAGE_PREFIX = 'dcau:account-snapshot';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) acc[key] = parsed;
    return acc;
  }, {} as Record<string, number>);
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    if (typeof raw === 'string' && raw.trim()) {
      acc[key] = raw;
    }
    return acc;
  }, {} as Record<string, string>);
}

function normalizeObjectMap(value: unknown): Record<string, Record<string, unknown>> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    acc[key] = asRecord(raw);
    return acc;
  }, {} as Record<string, Record<string, unknown>>);
}

function normalizeWindowMap(value: unknown): Record<string, AccountUsageWindow> {
  const map = asRecord(value);
  return Object.entries(map).reduce((acc, [key, raw]) => {
    const entry = asRecord(raw);
    acc[key] = {
      label: typeof entry.label === 'string' ? entry.label : '',
      policy: typeof entry.policy === 'string' ? entry.policy : '',
      interval_value: Number.isFinite(Number(entry.intervalValue ?? entry.interval_value))
        ? Number(entry.intervalValue ?? entry.interval_value)
        : null,
      interval_unit:
        typeof entry.intervalUnit === 'string'
          ? entry.intervalUnit
          : (typeof entry.interval_unit === 'string' ? entry.interval_unit : null),
      window_start: typeof entry.window_start === 'string' ? entry.window_start : '',
      window_end: typeof entry.window_end === 'string' ? entry.window_end : null,
    };
    return acc;
  }, {} as Record<string, AccountUsageWindow>);
}

export function buildUnknownAccountEntitlements(userId?: string | null): AccountEntitlementsSnapshot {
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
    retentionDays: FREE_PLAN_EXPIRATION_DAYS,
    asOf: null,
    source: 'unknown',
  };
}

function normalizeEntitlements(
  value: unknown,
  fallbackUserId: string | null,
): AccountEntitlementsSnapshot {
  const row = asRecord(value);
  const plan = (() => {
    const rawPlan = asString(row.plan);
    return rawPlan ? normalizeEffectiveEntitlementPlan(rawPlan) : 'unknown';
  })();
  const entitlementSource = normalizeBillingEntitlementSource(row.entitlementSource);
  const promoActive = row.promoActive === true;

  return {
    userId: asString(row.userId) || fallbackUserId,
    plan,
    hasPro:
      row.hasPro === true ||
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
    retentionDays: Math.max(1, Math.floor(asNumber(row.retentionDays, FREE_PLAN_EXPIRATION_DAYS))),
    asOf: asString(row.asOf),
    source: asString(row.source) || 'api',
  };
}

function normalizePlanSnapshot(value: unknown): AccountPlanSnapshot | null {
  const row = asRecord(value);
  if (Object.keys(row).length === 0) return null;
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

function normalizeCurrentPlan(
  value: unknown,
  entitlements: AccountEntitlementsSnapshot,
  fallbackPlan: string | null,
): NormalizedSubscriptionState {
  const row = asRecord(value);
  return deriveNormalizedSubscriptionState({
    effectivePlan: row.effectivePlan ?? entitlements.plan ?? fallbackPlan,
    entitlementSource: row.entitlementSource ?? entitlements.entitlementSource,
    promoActive:
      row.promoActive === true
        ? true
        : (row.promoActive === false ? false : entitlements.promoActive),
    subscriptionPlanKey: row.activePlanKey,
    subscriptionStatus: row.subscriptionStatus,
    latestPaymentPlanKey: row.activePlanKey,
    legacyTier: row.managedPlan ?? fallbackPlan ?? entitlements.plan,
  });
}

function accountSnapshotStorageKey(userId: string): string {
  return `${ACCOUNT_SNAPSHOT_STORAGE_PREFIX}:${userId}`;
}

export function normalizeAccountSnapshotPayload(
  payload: unknown,
  fallbackUserId?: string | null,
): PersistedCanonicalAccountSnapshot | null {
  const root = asRecord(asRecord(payload).snapshot ?? payload);
  const userId = asString(root.userId) || fallbackUserId || null;
  if (!userId) return null;

  const entitlements = normalizeEntitlements(root.entitlements, userId);
  const validatedAt =
    asString(root.validatedAt) ||
    entitlements.asOf ||
    asString(asRecord(root.planSnapshot).issuedAt);
  const effectivePlanRow = asRecord(root.effectivePlan);
  const plan =
    asString(root.plan) ||
    asString(effectivePlanRow.plan) ||
    (entitlements.plan !== 'unknown' ? entitlements.plan : null);
  if (!plan) return null;
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
      entitlementSource: normalizeBillingEntitlementSource(effectivePlanRow.entitlementSource),
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
      if (Object.keys(row).length === 0) return null;
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

export function resolveCachedAccountSnapshotFallback(input: {
  cachedSnapshot: PersistedCanonicalAccountSnapshot | null;
  cachedAt: number | null;
  previousSnapshot: PersistedCanonicalAccountSnapshot | null;
  previousCachedAt?: number | null;
}): CachedAccountSnapshotFallback {
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

export function readPersistedAccountSnapshotSync(
  userId: string | null | undefined,
): { snapshot: PersistedCanonicalAccountSnapshot | null; cachedAt: number | null } {
  if (!userId || typeof window === 'undefined') {
    return { snapshot: null, cachedAt: null };
  }

  try {
    const raw = window.localStorage.getItem(accountSnapshotStorageKey(userId));
    if (!raw) return { snapshot: null, cachedAt: null };
    const parsed = JSON.parse(raw) as PersistedAccountSnapshotEnvelope;
    if (!parsed || parsed.schemaVersion !== ACCOUNT_SNAPSHOT_CACHE_SCHEMA) {
      return { snapshot: null, cachedAt: null };
    }
    const snapshot = normalizeAccountSnapshotPayload(parsed.snapshot, userId);
    if (!snapshot) return { snapshot: null, cachedAt: null };
    return {
      snapshot,
      cachedAt: Number.isFinite(Number(parsed.cachedAt)) ? Number(parsed.cachedAt) : null,
    };
  } catch {
    return { snapshot: null, cachedAt: null };
  }
}

export function writePersistedAccountSnapshotSync(
  snapshot: PersistedCanonicalAccountSnapshot,
  cachedAt: number,
): void {
  if (!snapshot.userId || typeof window === 'undefined') return;
  try {
    const envelope: PersistedAccountSnapshotEnvelope = {
      schemaVersion: ACCOUNT_SNAPSHOT_CACHE_SCHEMA,
      cachedAt,
      snapshot,
    };
    window.localStorage.setItem(accountSnapshotStorageKey(snapshot.userId), JSON.stringify(envelope));
  } catch {
    // Ignore storage failures; IndexedDB/user-cache remains the primary store.
  }
}

export function clearPersistedAccountSnapshotSync(userId: string | null | undefined): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(accountSnapshotStorageKey(userId));
  } catch {
    // Ignore storage cleanup failures.
  }
}
