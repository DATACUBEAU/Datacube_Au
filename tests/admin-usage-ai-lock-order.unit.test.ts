import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830214500_admin_usage_advisory_before_version.sql',
  'utf8',
);

const single = migration.match(
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_versioned[\s\S]+?\n\$\$;/i,
)?.[0];
const batch = migration.match(
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+?\n\$\$;/i,
)?.[0];

assert.ok(single, 'single-item admin usage wrapper must be present');
assert.ok(batch, 'batch admin usage wrapper must be present');

// Authentication must still happen before attacker-controlled lock work.
assert.match(
  single,
  /IF v_role <> 'service_role'[\s\S]+NOT public\.is_conex_admin\(v_requester\)[\s\S]+RAISE EXCEPTION 'forbidden'[\s\S]+pg_advisory_xact_lock/i,
);
assert.match(
  batch,
  /IF v_role <> 'service_role'[\s\S]+NOT public\.is_conex_admin\(v_requester\)[\s\S]+RAISE EXCEPTION 'forbidden'[\s\S]+pg_advisory_xact_lock/i,
);

// The quota-window advisory lock must be owned before the mutation-version row.
// Live AI admission uses counter -> total -> advisory -> version; this prevents the
// previous admin version -> advisory inversion from completing a deadlock cycle.
assert.match(
  single,
  /pg_advisory_xact_lock[\s\S]+INSERT INTO public\.au_usage_mutation_versions[\s\S]+FOR UPDATE/i,
);
assert.doesNotMatch(
  single,
  /FOR UPDATE[\s\S]+pg_advisory_xact_lock[\s\S]+admin_assert_usage_adjustment_replay/i,
);

// Batch corrections must acquire every exact window lock in deterministic order
// before touching the one shared mutation-version row.
assert.match(
  batch,
  /SELECT DISTINCT hashtextextended[\s\S]+ORDER BY lock_key[\s\S]+pg_advisory_xact_lock\(v_lock_key\)[\s\S]+INSERT INTO public\.au_usage_mutation_versions[\s\S]+FOR UPDATE/i,
);

// The lock identity must remain identical to the checked RPC / AI canonical path.
for (const body of [single, batch]) {
  assert.match(body, /concat_ws\([\s\S]+p_target_user_id::TEXT[\s\S]+metricKey|p_metric_key/i);
  assert.match(body, /hashtextextended[\s\S]+,\s*0\s*\)/i);
}

// Preserve the complete safety composition after reordering the locks.
assert.match(
  single,
  /FOR UPDATE[\s\S]+admin_assert_usage_adjustment_replay[\s\S]+assert_no_active_ai_usage_reservation[\s\S]+admin_checkpoint_legacy_usage_gap[\s\S]+admin_adjust_usage_checked/i,
);
assert.match(
  batch,
  /FOR UPDATE[\s\S]+admin_assert_usage_adjustment_replay[\s\S]+assert_no_active_ai_usage_reservation[\s\S]+admin_checkpoint_legacy_usage_gap[\s\S]+admin_adjust_usage_batch_checked/i,
);

// Keep the public API and data-safety posture unchanged.
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_versioned[\s\S]+TO authenticated/i);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+TO authenticated/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments|ai_usage_reservations)/i,
);

console.log('admin/AI usage lock-order regressions passed');
