import {
  FREE_PLAN_EXPIRATION_DAYS,
  PAID_PRO_PLAN_EXPIRATION_DAYS,
  PROMO_PLAN_EXPIRATION_DAYS,
  resolvePlanExpirationDays,
} from '../plans/subscription-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

export const FILE_CLEANUP_INACTIVITY_DAYS = 7;
export const ACCOUNT_DELETION_INACTIVITY_DAYS = 14;
export const MAX_AUTOMATIC_RETENTION_ATTEMPTS = 5;
export const RETENTION_POLICY_VERSION = '2026-07-29-data-security-notice';

export type RetentionScope = 'plan_expiry' | 'inactive_files' | 'inactive_account';
export type RetentionTargetType = 'document' | 'user';
export type RetentionActionStatus = 'eligible' | 'in_progress' | 'deleted' | 'failed' | 'skipped';
export type RetentionLifecycleState =
  | 'active'
  | 'scheduled_file_deletion'
  | 'files_deleted'
  | 'scheduled_full_deletion'
  | 'fully_deleted'
  | 'deletion_failed';

export function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const candidate = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(candidate.getTime())) return null;
  return candidate;
}

export function toIsoOrNull(value: string | Date | null | undefined): string | null {
  const date = toValidDate(value);
  return date ? date.toISOString() : null;
}

export function addDaysIso(value: string | Date | null | undefined, days: number): string | null {
  const date = toValidDate(value);
  if (!date) return null;
  return new Date(date.getTime() + Math.max(0, Math.floor(days)) * DAY_MS).toISOString();
}

export function resolveLastSeenAt(values: Array<string | Date | null | undefined>): string | null {
  let latest: Date | null = null;
  for (const value of values) {
    const candidate = toValidDate(value);
    if (!candidate) continue;
    if (!latest || candidate.getTime() > latest.getTime()) {
      latest = candidate;
    }
  }
  return latest ? latest.toISOString() : null;
}

export function computeUploadExpiryFromPlan(input: {
  createdAt: string | Date | null | undefined;
  plan?: string | null | undefined;
  entitlementSource?: string | null | undefined;
}): string | null {
  const createdAt = toValidDate(input.createdAt);
  if (!createdAt) return null;
  const retentionDays = resolvePlanExpirationDays({
    plan: input.plan,
    entitlementSource: input.entitlementSource,
  });
  return addDaysIso(createdAt, retentionDays);
}

export function resolveDocumentRetentionDays(input: {
  plan?: string | null | undefined;
  entitlementSource?: string | null | undefined;
}): number {
  return resolvePlanExpirationDays(input);
}

export function resolveDocumentRetentionTier(input: {
  plan?: string | null | undefined;
  entitlementSource?: string | null | undefined;
}): 'free' | 'promo' | 'pro' {
  const source = String(input.entitlementSource || '').trim().toLowerCase();
  if (source === 'promo') return 'promo';
  const plan = String(input.plan || '').trim().toLowerCase();
  if (['pro', 'premium', 'admin', 'paid', 'weekly', 'monthly'].includes(plan)) return 'pro';
  return 'free';
}

export function computeDocumentDeletionEligibility(input: {
  createdAt?: string | Date | null;
  expiresAt?: string | Date | null;
  lastSeenAt?: string | Date | null;
  plan?: string | null;
  entitlementSource?: string | null;
  now?: string | Date;
}): {
  eligible: boolean;
  scope: Extract<RetentionScope, 'plan_expiry' | 'inactive_files'> | null;
  reason: string | null;
  planExpiryAt: string | null;
  inactivityDeleteAt: string | null;
  deleteAfter: string | null;
} {
  const nowDate = toValidDate(input.now || new Date());
  if (!nowDate) {
    return {
      eligible: false,
      scope: null,
      reason: null,
      planExpiryAt: null,
      inactivityDeleteAt: null,
      deleteAfter: null,
    };
  }

  const storedExpiry = toIsoOrNull(input.expiresAt);
  const fallbackPlanExpiry = computeUploadExpiryFromPlan({
    createdAt: input.createdAt,
    plan: input.plan,
    entitlementSource: input.entitlementSource,
  });
  const planExpiryAt = storedExpiry || fallbackPlanExpiry;
  const inactivityDeleteAt = getFileCleanupDueAt(input.lastSeenAt);

  const candidates: Array<{
    scope: Extract<RetentionScope, 'plan_expiry' | 'inactive_files'>;
    dueAt: string;
    reason: string;
  }> = [];

  const planExpiryDate = toValidDate(planExpiryAt);
  if (planExpiryDate && planExpiryDate.getTime() <= nowDate.getTime()) {
    candidates.push({
      scope: 'plan_expiry',
      dueAt: planExpiryDate.toISOString(),
      reason: 'Document reached its stored retention expiry.',
    });
  }

  const inactivityDate = toValidDate(inactivityDeleteAt);
  if (inactivityDate && inactivityDate.getTime() <= nowDate.getTime()) {
    candidates.push({
      scope: 'inactive_files',
      dueAt: inactivityDate.toISOString(),
      reason: 'Owner has had no verified authenticated activity for seven days.',
    });
  }

  if (candidates.length === 0) {
    return {
      eligible: false,
      scope: null,
      reason: null,
      planExpiryAt,
      inactivityDeleteAt,
      deleteAfter: null,
    };
  }

  candidates.sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  const earliest = candidates[0];
  return {
    eligible: true,
    scope: earliest.scope,
    reason: earliest.reason,
    planExpiryAt,
    inactivityDeleteAt,
    deleteAfter: earliest.dueAt,
  };
}

export function resolveRetentionDeadlineAfterPlanChange(input: {
  uploadedAt: string | Date | null | undefined;
  currentExpiresAt?: string | Date | null;
  previousPlan?: string | null;
  previousEntitlementSource?: string | null;
  nextPlan?: string | null;
  nextEntitlementSource?: string | null;
}): string | null {
  const uploadedAt = toValidDate(input.uploadedAt);
  if (!uploadedAt) return toIsoOrNull(input.currentExpiresAt);

  const currentExpiry = toValidDate(input.currentExpiresAt);
  const nextDays = resolvePlanExpirationDays({
    plan: input.nextPlan,
    entitlementSource: input.nextEntitlementSource,
  });
  const previousDays = resolvePlanExpirationDays({
    plan: input.previousPlan,
    entitlementSource: input.previousEntitlementSource,
  });
  const nextExpiry = toValidDate(addDaysIso(uploadedAt, nextDays));
  if (!nextExpiry) return currentExpiry?.toISOString() || null;

  if (nextDays > previousDays) {
    if (!currentExpiry || nextExpiry.getTime() > currentExpiry.getTime()) {
      return nextExpiry.toISOString();
    }
    return currentExpiry.toISOString();
  }

  if (nextDays < previousDays && currentExpiry) {
    return currentExpiry.toISOString();
  }

  return currentExpiry?.toISOString() || nextExpiry.toISOString();
}

export function getRetentionPolicySnapshot() {
  return {
    version: RETENTION_POLICY_VERSION,
    signedOutDocumentCleanupDays: FILE_CLEANUP_INACTIVITY_DAYS,
    freeDocumentExpirationDays: FREE_PLAN_EXPIRATION_DAYS,
    promoDocumentExpirationDays: PROMO_PLAN_EXPIRATION_DAYS,
    paidProDocumentExpirationDays: PAID_PRO_PLAN_EXPIRATION_DAYS,
    accountDeletionInactivityDays: null as number | null,
  };
}

export function getFileCleanupDueAt(lastSeenAt: string | Date | null | undefined): string | null {
  return addDaysIso(lastSeenAt, FILE_CLEANUP_INACTIVITY_DAYS);
}

export function getFullDeletionDueAt(lastSeenAt: string | Date | null | undefined): string | null {
  return addDaysIso(lastSeenAt, ACCOUNT_DELETION_INACTIVITY_DAYS);
}

export function isFileCleanupDue(
  lastSeenAt: string | Date | null | undefined,
  now: string | Date = new Date(),
): boolean {
  const dueAt = toValidDate(getFileCleanupDueAt(lastSeenAt));
  const nowDate = toValidDate(now);
  return Boolean(dueAt && nowDate && dueAt.getTime() <= nowDate.getTime());
}

export function isFullDeletionDue(
  lastSeenAt: string | Date | null | undefined,
  now: string | Date = new Date(),
): boolean {
  const dueAt = toValidDate(getFullDeletionDueAt(lastSeenAt));
  const nowDate = toValidDate(now);
  return Boolean(dueAt && nowDate && dueAt.getTime() <= nowDate.getTime());
}

export function shouldSkipAutomaticRetry(
  attempts: number | null | undefined,
  maxAttempts = MAX_AUTOMATIC_RETENTION_ATTEMPTS,
): boolean {
  return Math.max(0, Number(attempts || 0)) >= Math.max(1, Math.floor(maxAttempts));
}

export function isStorageMissingError(error: unknown): boolean {
  const text = String(
    (error as any)?.message ||
      (error as any)?.error ||
      (error as any)?.details ||
      error ||
      '',
  ).toLowerCase();
  return (
    text.includes('not found') ||
    text.includes('no such object') ||
    text.includes('already deleted') ||
    text.includes('does not exist')
  );
}

export function scopePriority(scope: RetentionScope): number {
  if (scope === 'inactive_account') return 3;
  if (scope === 'inactive_files') return 2;
  return 1;
}

export function deriveRetentionLifecycleState(input: {
  lastSeenAt?: string | null;
  documentsRemaining?: number | null;
  latestActionStatus?: string | null;
  latestActionScope?: string | null;
  latestActionError?: string | null;
  now?: string | Date;
}): RetentionLifecycleState {
  const documentsRemaining = Math.max(0, Number(input.documentsRemaining || 0));
  const latestStatus = String(input.latestActionStatus || '').trim().toLowerCase();
  const latestScope = String(input.latestActionScope || '').trim().toLowerCase();
  const latestError = String(input.latestActionError || '').trim();

  if (latestStatus === 'failed' || latestError) {
    return 'deletion_failed';
  }

  if (latestStatus === 'deleted' && latestScope === 'inactive_account') {
    return 'fully_deleted';
  }

  if (
    latestStatus === 'deleted' &&
    (latestScope === 'inactive_files' || latestScope === 'plan_expiry') &&
    documentsRemaining === 0
  ) {
    return 'files_deleted';
  }

  if (documentsRemaining > 0 && isFileCleanupDue(input.lastSeenAt, input.now)) {
    return 'scheduled_file_deletion';
  }

  return 'active';
}
