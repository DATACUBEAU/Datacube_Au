import { resolvePlanExpirationDays } from '../plans/subscription-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

export const FILE_CLEANUP_INACTIVITY_DAYS = 7;
export const ACCOUNT_DELETION_INACTIVITY_DAYS = 14;
export const MAX_AUTOMATIC_RETENTION_ATTEMPTS = 5;

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

  if (isFullDeletionDue(input.lastSeenAt, input.now)) {
    return 'scheduled_full_deletion';
  }

  if (documentsRemaining > 0 && isFileCleanupDue(input.lastSeenAt, input.now)) {
    return 'scheduled_file_deletion';
  }

  return 'active';
}
