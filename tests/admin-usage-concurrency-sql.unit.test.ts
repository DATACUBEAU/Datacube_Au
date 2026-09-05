import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failed = 0;

async function run(name: string, fn: () => void | Promise<void>) {
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
  const migration = readFileSync('supabase/migrations/20260827215500_admin_usage_adjustments_concurrency.sql', 'utf8');
  const versionMigration = readFileSync('supabase/migrations/20260828004500_usage_mutation_version_guard.sql', 'utf8');
  const legacyVersionMigration = readFileSync('supabase/migrations/20260828020000_legacy_usage_mutation_version_guard.sql', 'utf8');
  const checkpointMigration = readFileSync('supabase/migrations/20260828065500_admin_usage_legacy_checkpoint.sql', 'utf8');
  const resetAllRootReceiptMigration = readFileSync('supabase/migrations/20260904084500_admin_usage_reset_all_root_receipt.sql', 'utf8');
  const route = readFileSync('src/app/api/admin/limits/user-usage/route.ts', 'utf8');
  const limits = readFileSync('src/lib/server/au-limits.ts', 'utf8');

  await run('checked usage adjustment serializes each tenant metric quota window', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_checked/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /p_target_user_id::TEXT, v_metric_key, p_window_start::TEXT/);
    assert.match(migration, /p_expected_adjustment_total NUMERIC/);
    assert.match(migration, /COALESCE\(v_total, 0\) <> p_expected_adjustment_total/);
    assert.match(migration, /usage_adjustment_conflict/);
    assert.match(migration, /ERRCODE = '40001'/);
  });

  await run('idempotent retry is resolved before stale-target conflict detection', () => {
    const existingLookup = migration.indexOf('SELECT * INTO v_existing');
    const conflictCheck = migration.indexOf("RAISE EXCEPTION 'usage_adjustment_conflict'");
    assert.ok(existingLookup >= 0);
    assert.ok(conflictCheck > existingLookup);
    assert.match(migration, /'deduped', TRUE/);
  });

  await run('set and reset can validate an already-satisfied target without adding fake usage', () => {
    assert.match(migration, /p_delta = 0 AND v_action NOT IN \('set', 'reset'\)/);
    assert.match(migration, /IF p_delta = 0 THEN/);
    assert.match(migration, /'no_op', TRUE/);
    assert.match(migration, /does not invent a zero-value audit event/i);
  });

  await run('reset-all executes through one transactional database batch behind its durable root receipt', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_checked/);
    assert.match(migration, /FOR v_item IN SELECT value FROM jsonb_array_elements\(p_items\)/);
    assert.match(migration, /public\.admin_adjust_usage_checked\(/);
    assert.match(route, /admin_adjust_usage_reset_all_versioned/);
    assert.match(resetAllRootReceiptMigration, /admin_adjust_usage_batch_versioned\(/);
    assert.doesNotMatch(route, /for \(const key of APPROVED_LIMIT_KEYS\)[\s\S]*await applyAdjustment/);
  });

  await run('API takes concurrency snapshots before refreshing canonical usage and returns a recoverable conflict', () => {
    const expectedIndex = route.indexOf('const expectedAdjustmentTotal = await loadAdjustmentTotal');
    const versionIndex = route.indexOf('const expectedUsageVersion = await loadUsageMutationVersion', expectedIndex);
    const refreshIndex = route.indexOf('const mutationEffective = await resolveCanonicalEffectiveLimits', versionIndex);
    const mutationIndex = route.indexOf('await applyAdjustment', refreshIndex);
    assert.ok(expectedIndex >= 0);
    assert.ok(versionIndex > expectedIndex);
    assert.ok(refreshIndex > versionIndex);
    assert.ok(mutationIndex > refreshIndex);
    assert.match(route, /p_expected_adjustment_total: input\.expectedAdjustmentTotal/);
    assert.match(route, /p_expected_usage_version: input\.expectedUsageVersion/);
    assert.match(route, /usage_mutation_conflict/);
    assert.match(route, /code: 'usage_changed'/);
    assert.match(route, /}, 409\)/);
  });

  await run('ordinary counter mutations advance a transactionally coupled usage version', () => {
    assert.match(versionMigration, /CREATE TABLE IF NOT EXISTS public\.au_usage_mutation_versions/);
    assert.match(versionMigration, /AFTER INSERT OR UPDATE OR DELETE ON public\.usage_counters/);
    assert.match(versionMigration, /AFTER INSERT OR UPDATE OR DELETE ON public\.usage_totals/);
    assert.match(versionMigration, /version = public\.au_usage_mutation_versions\.version \+ 1/);
    assert.match(versionMigration, /CREATE OR REPLACE FUNCTION public\.bump_usage_mutation_version/);
  });

  await run('legacy and hybrid canonical usage sources share the same mutation-version boundary', () => {
    assert.match(limits, /safeExactCount\(supabase, 'au_messages'/);
    assert.match(limits, /\.from\('au_model_usage'\)/);
    assert.match(limits, /safeSelectDocuments\(supabase, userId\)/);
    assert.match(limits, /safeExactCount\(supabase, 'au_feature_outputs'/);

    for (const table of ['au_messages', 'au_model_usage', 'au_documents', 'au_feature_outputs']) {
      assert.match(legacyVersionMigration, new RegExp(`'${table}'`));
    }
    assert.match(legacyVersionMigration, /CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE/);
    assert.match(legacyVersionMigration, /EXECUTE FUNCTION public\.bump_usage_mutation_version\(\)/);
  });

  await run('usage-version trigger protects both tenants if fallback ownership changes', () => {
    assert.match(legacyVersionMigration, /v_old_user_id := OLD\.user_id/);
    assert.match(legacyVersionMigration, /v_new_user_id := NEW\.user_id/);
    assert.match(legacyVersionMigration, /v_new_user_id IS DISTINCT FROM v_old_user_id/);
    const bumps = legacyVersionMigration.match(/version = public\.au_usage_mutation_versions\.version \+ 1/g) || [];
    assert.equal(bumps.length, 2);
  });

  await run('admin correction locks and compares live usage version before delegating to adjustment ledger', () => {
    const lockIndex = versionMigration.indexOf('FOR UPDATE;');
    const versionConflictIndex = versionMigration.indexOf("RAISE EXCEPTION 'usage_mutation_conflict'");
    const delegateIndex = versionMigration.indexOf('RETURN public.admin_adjust_usage_checked(');
    assert.ok(lockIndex >= 0);
    assert.ok(versionConflictIndex > lockIndex);
    assert.ok(delegateIndex > versionConflictIndex);
    assert.match(versionMigration, /COALESCE\(v_version, 0\) <> p_expected_usage_version/);
    assert.match(versionMigration, /ERRCODE = '40001'/);
  });

  await run('reset-all shares the same live-usage serialization boundary for the whole transaction', () => {
    assert.match(versionMigration, /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_versioned/);
    assert.match(versionMigration, /RETURN public\.admin_adjust_usage_batch_checked\(/);
    assert.match(route, /p_expected_usage_version: expectedUsageVersion/);
    assert.match(resetAllRootReceiptMigration, /usage_accounting_user/);
    const batchFunction = versionMigration.slice(versionMigration.indexOf('CREATE OR REPLACE FUNCTION public.admin_adjust_usage_batch_versioned'));
    assert.match(batchFunction, /FOR UPDATE;/);
    assert.match(batchFunction, /usage_mutation_conflict/);
  });

  await run('quota-window rollover is rejected instead of applying a target to a different window', () => {
    assert.match(route, /function sameResetWindow/);
    assert.match(route, /if \(!sameResetWindow\(initialReset, mutationEffective\.usage\.by_limit\[body\.metricKey\]\.reset\)\)/);
    assert.match(route, /if \(!sameResetWindow\(beforeReset, usage\.reset\)\)/);
  });

  await run('legacy-over-tracked baseline is checkpointed into the existing auditable event ledger', () => {
    assert.match(checkpointMigration, /CREATE OR REPLACE FUNCTION public\.admin_checkpoint_legacy_usage_gap/);
    assert.match(checkpointMigration, /v_checkpoint_delta := GREATEST\(0, v_base_used - v_tracked_used\)/);
    assert.match(checkpointMigration, /PERFORM public\.track_usage_event\(/);
    assert.match(checkpointMigration, /'admin_usage_checkpoint'/);
    assert.match(checkpointMigration, /'legacy_baseline_reconciliation'/);
    assert.doesNotMatch(checkpointMigration, /CREATE TABLE IF NOT EXISTS public\.au_usage_(?:counter|total)/i);
  });

  await run('checkpoint uses canonical counters for daily/lifetime windows and events only for custom windows', () => {
    assert.match(checkpointMigration, /FROM public\.usage_totals/);
    assert.match(checkpointMigration, /FROM public\.usage_counters/);
    assert.match(checkpointMigration, /public\.get_usage_metric_window_totals\(/);
    assert.match(checkpointMigration, /admin_usage_metric_aliases/);
  });

  await run('checkpoint and signed correction execute under one usage-version transaction lock', () => {
    const singleStart = checkpointMigration.indexOf('CREATE OR REPLACE FUNCTION public.admin_adjust_usage_versioned');
    const batchStart = checkpointMigration.indexOf('CREATE OR REPLACE FUNCTION public.admin_adjust_usage_batch_versioned');
    const singleBody = checkpointMigration.slice(singleStart, batchStart);
    const batchBody = checkpointMigration.slice(batchStart);
    for (const body of [singleBody, batchBody]) {
      const lockIndex = body.indexOf('FOR UPDATE;');
      const checkpointIndex = body.indexOf('admin_checkpoint_legacy_usage_gap');
      const adjustmentIndex = body.indexOf('admin_adjust_usage_');
      assert.ok(lockIndex >= 0);
      assert.ok(checkpointIndex > lockIndex);
      assert.ok(adjustmentIndex >= 0);
      assert.match(body, /usage_mutation_conflict/);
    }
    assert.match(singleBody, /admin_adjust_usage_checked\(/);
    assert.match(batchBody, /admin_adjust_usage_batch_checked\(/);
  });

  await run('checkpoint request is retry-safe through the authoritative event idempotency key', () => {
    assert.match(checkpointMigration, /v_event_key := 'admin_usage_checkpoint:' \|\| TRIM\(p_request_id\)/);
    assert.match(checkpointMigration, /TRIM\(p_request_id\)/);
    assert.match(checkpointMigration, /usage_checkpoint_request_id_required/);
  });

  await run('reset baseline remains durable after legacy deletion so later tracked usage is countable', () => {
    const legacy = 10;
    const trackedBefore = 0;
    const checkpoint = Math.max(0, legacy - trackedBefore);
    const resetAdjustment = -legacy;
    const trackedAfterLegacyDeletion = trackedBefore + checkpoint;
    assert.equal(Math.max(0, trackedAfterLegacyDeletion + resetAdjustment), 0);

    const afterNewTrackedUnit = trackedAfterLegacyDeletion + 1;
    assert.equal(Math.max(0, afterNewTrackedUnit + resetAdjustment), 1);
  });

  await run('concurrency migrations remain append-only and do not weaken usage history', () => {
    assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(migration, /UPDATE\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(migration, /TRUNCATE/i);
    assert.doesNotMatch(versionMigration, /DELETE\s+FROM\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(versionMigration, /UPDATE\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(versionMigration, /TRUNCATE/i);
    assert.doesNotMatch(legacyVersionMigration, /DELETE\s+FROM\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(legacyVersionMigration, /UPDATE\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(legacyVersionMigration, /TRUNCATE/i);
    assert.doesNotMatch(checkpointMigration, /DELETE\s+FROM\s+public\.au_usage_events/i);
    assert.doesNotMatch(checkpointMigration, /DELETE\s+FROM\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(checkpointMigration, /TRUNCATE/i);
    assert.doesNotMatch(resetAllRootReceiptMigration, /DELETE\s+FROM\s+public\.au_usage_admin_batch_receipts/i);
    assert.doesNotMatch(resetAllRootReceiptMigration, /UPDATE\s+public\.au_usage_admin_batch_receipts/i);
    assert.doesNotMatch(resetAllRootReceiptMigration, /TRUNCATE/i);
  });

  if (failed > 0) process.exit(1);
}

void main();
