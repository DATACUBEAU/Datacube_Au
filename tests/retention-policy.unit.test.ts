import assert from 'node:assert/strict';
import {
  computeDocumentDeletionEligibility,
  computeUploadExpiryFromPlan,
  deriveRetentionLifecycleState,
  getFileCleanupDueAt,
  getFullDeletionDueAt,
  getRetentionPolicySnapshot,
  isFileCleanupDue,
  isFullDeletionDue,
  isStorageMissingError,
  resolveRetentionDeadlineAfterPlanChange,
  shouldSkipAutomaticRetry,
} from '../src/lib/server/retention-policy.js';

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

async function main() {
  await run('free uploads expire after 14 days', () => {
    assert.equal(
      computeUploadExpiryFromPlan({
        createdAt: '2026-03-01T00:00:00.000Z',
        plan: 'free',
        entitlementSource: 'none',
      }),
      '2026-03-15T00:00:00.000Z',
    );
  });

  await run('promo uploads expire after 14 days', () => {
    assert.equal(
      computeUploadExpiryFromPlan({
        createdAt: '2026-03-01T00:00:00.000Z',
        plan: 'promo_pro',
        entitlementSource: 'promo',
      }),
      '2026-03-15T00:00:00.000Z',
    );
  });

  await run('paid Pro uploads expire after 30 days', () => {
    assert.equal(
      computeUploadExpiryFromPlan({
        createdAt: '2026-03-01T00:00:00.000Z',
        plan: 'pro',
        entitlementSource: 'paid',
      }),
      '2026-03-31T00:00:00.000Z',
    );
  });

  await run('7 day inactivity marks file cleanup due', () => {
    const lastSeenAt = '2026-03-01T12:00:00.000Z';
    assert.equal(getFileCleanupDueAt(lastSeenAt), '2026-03-08T12:00:00.000Z');
    assert.equal(isFileCleanupDue(lastSeenAt, '2026-03-08T12:00:00.000Z'), true);
    assert.equal(isFileCleanupDue(lastSeenAt, '2026-03-08T11:59:59.000Z'), false);
  });

  await run('legacy full-deletion helper remains available for manual admin flows only', () => {
    const lastSeenAt = '2026-03-01T12:00:00.000Z';
    assert.equal(getFullDeletionDueAt(lastSeenAt), '2026-03-15T12:00:00.000Z');
    assert.equal(isFullDeletionDue(lastSeenAt, '2026-03-15T12:00:00.000Z'), true);
    assert.equal(isFullDeletionDue(lastSeenAt, '2026-03-15T11:59:59.000Z'), false);
  });

  await run('policy snapshot does not schedule automatic account deletion', () => {
    const policy = getRetentionPolicySnapshot();
    assert.equal(policy.signedOutDocumentCleanupDays, 7);
    assert.equal(policy.freeDocumentExpirationDays, 14);
    assert.equal(policy.promoDocumentExpirationDays, 14);
    assert.equal(policy.paidProDocumentExpirationDays, 30);
    assert.equal(policy.accountDeletionInactivityDays, null);
  });

  await run('automatic retries stop after the cap', () => {
    assert.equal(shouldSkipAutomaticRetry(4), false);
    assert.equal(shouldSkipAutomaticRetry(5), true);
    assert.equal(shouldSkipAutomaticRetry(8), true);
  });

  await run('missing storage objects are treated as non-fatal cleanup results', () => {
    assert.equal(isStorageMissingError({ message: 'Object not found' }), true);
    assert.equal(isStorageMissingError({ details: 'No such object' }), true);
    assert.equal(isStorageMissingError({ message: 'Permission denied' }), false);
  });

  await run('lifecycle state shows scheduled file deletion before full deletion', () => {
    const state = deriveRetentionLifecycleState({
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      documentsRemaining: 2,
      now: '2026-03-09T00:00:00.000Z',
    });
    assert.equal(state, 'scheduled_file_deletion');
  });

  await run('lifecycle state does not schedule account deletion after inactivity', () => {
    const state = deriveRetentionLifecycleState({
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      documentsRemaining: 1,
      now: '2026-03-16T00:00:00.000Z',
    });
    assert.equal(state, 'scheduled_file_deletion');
  });

  await run('deleted file cleanup state is preserved when documents are gone', () => {
    const state = deriveRetentionLifecycleState({
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      documentsRemaining: 0,
      latestActionStatus: 'deleted',
      latestActionScope: 'inactive_files',
      now: '2026-03-16T00:00:00.000Z',
    });
    assert.equal(state, 'files_deleted');
  });

  await run('full account deletion state is preserved after backend deletion completes', () => {
    const state = deriveRetentionLifecycleState({
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      documentsRemaining: 0,
      latestActionStatus: 'deleted',
      latestActionScope: 'inactive_account',
      now: '2026-03-16T00:00:00.000Z',
    });
    assert.equal(state, 'fully_deleted');
  });

  await run('inactive for less than seven days is retained', () => {
    const result = computeDocumentDeletionEligibility({
      createdAt: '2026-03-01T00:00:00.000Z',
      expiresAt: '2026-03-30T00:00:00.000Z',
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      now: '2026-03-07T23:59:59.000Z',
    });
    assert.equal(result.eligible, false);
  });

  await run('inactive for seven days is eligible for document cleanup', () => {
    const result = computeDocumentDeletionEligibility({
      createdAt: '2026-03-01T00:00:00.000Z',
      expiresAt: '2026-03-30T00:00:00.000Z',
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      now: '2026-03-08T00:00:00.000Z',
    });
    assert.equal(result.eligible, true);
    assert.equal(result.scope, 'inactive_files');
    assert.equal(result.deleteAfter, '2026-03-08T00:00:00.000Z');
  });

  await run('Free and Promo documents are eligible at or after 14 days', () => {
    const free = computeDocumentDeletionEligibility({
      createdAt: '2026-03-01T00:00:00.000Z',
      lastSeenAt: '2026-03-14T00:00:00.000Z',
      plan: 'free',
      entitlementSource: 'none',
      now: '2026-03-15T00:00:00.000Z',
    });
    const promo = computeDocumentDeletionEligibility({
      createdAt: '2026-03-01T00:00:00.000Z',
      lastSeenAt: '2026-03-14T00:00:00.000Z',
      plan: 'promo_pro',
      entitlementSource: 'promo',
      now: '2026-03-15T00:00:00.000Z',
    });
    assert.equal(free.eligible, true);
    assert.equal(free.scope, 'plan_expiry');
    assert.equal(promo.eligible, true);
    assert.equal(promo.scope, 'plan_expiry');
  });

  await run('Pro documents are retained before 30 days and eligible at 30 days', () => {
    const before = computeDocumentDeletionEligibility({
      createdAt: '2026-03-01T00:00:00.000Z',
      lastSeenAt: '2026-03-30T00:00:00.000Z',
      plan: 'pro',
      entitlementSource: 'paid',
      now: '2026-03-30T23:59:59.000Z',
    });
    const atDeadline = computeDocumentDeletionEligibility({
      createdAt: '2026-03-01T00:00:00.000Z',
      lastSeenAt: '2026-03-30T00:00:00.000Z',
      plan: 'pro',
      entitlementSource: 'paid',
      now: '2026-03-31T00:00:00.000Z',
    });
    assert.equal(before.eligible, false);
    assert.equal(atDeadline.eligible, true);
    assert.equal(atDeadline.scope, 'plan_expiry');
  });

  await run('earliest deadline wins between plan expiry and inactivity', () => {
    const inactivityFirst = computeDocumentDeletionEligibility({
      createdAt: '2026-03-01T00:00:00.000Z',
      expiresAt: '2026-03-20T00:00:00.000Z',
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      now: '2026-03-21T00:00:00.000Z',
    });
    assert.equal(inactivityFirst.scope, 'inactive_files');
    assert.equal(inactivityFirst.deleteAfter, '2026-03-08T00:00:00.000Z');
  });

  await run('upgrade may extend an unexpired document deadline', () => {
    const next = resolveRetentionDeadlineAfterPlanChange({
      uploadedAt: '2026-03-01T00:00:00.000Z',
      currentExpiresAt: '2026-03-15T00:00:00.000Z',
      previousPlan: 'free',
      previousEntitlementSource: 'none',
      nextPlan: 'pro',
      nextEntitlementSource: 'paid',
    });
    assert.equal(next, '2026-03-31T00:00:00.000Z');
  });

  await run('downgrade does not shorten an existing later deadline', () => {
    const next = resolveRetentionDeadlineAfterPlanChange({
      uploadedAt: '2026-03-01T00:00:00.000Z',
      currentExpiresAt: '2026-03-31T00:00:00.000Z',
      previousPlan: 'pro',
      previousEntitlementSource: 'paid',
      nextPlan: 'free',
      nextEntitlementSource: 'none',
    });
    assert.equal(next, '2026-03-31T00:00:00.000Z');
  });

  await run('users without documents do not show scheduled file deletion once files are gone', () => {
    const state = deriveRetentionLifecycleState({
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      documentsRemaining: 0,
      now: '2026-03-09T00:00:00.000Z',
    });
    assert.equal(state, 'active');
  });

  await run('failed actions surface deletion_failed explicitly', () => {
    const state = deriveRetentionLifecycleState({
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      documentsRemaining: 0,
      latestActionStatus: 'failed',
      latestActionScope: 'inactive_account',
      latestActionError: 'storage_delete_failed',
      now: '2026-03-16T00:00:00.000Z',
    });
    assert.equal(state, 'deletion_failed');
  });

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
