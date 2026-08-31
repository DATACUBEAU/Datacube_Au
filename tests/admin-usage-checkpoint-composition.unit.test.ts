import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830124500_admin_usage_wrapper_authorization.sql',
  'utf8',
);
const replayFastPathMigration = readFileSync(
  'supabase/migrations/20260831234000_admin_usage_completed_replay_fast_path.sql',
  'utf8',
);

// Both exposed SECURITY DEFINER wrappers must authenticate before touching the
// mutation-version row, replay ledger, reservations, checkpoint sources, or batch items.
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_versioned[\s\S]+v_requester UUID := auth\.uid\(\)[\s\S]+v_role TEXT[\s\S]+IF v_role <> 'service_role'[\s\S]+v_requester <> p_actor_user_id[\s\S]+NOT public\.is_conex_admin\(v_requester\)[\s\S]+RAISE EXCEPTION 'forbidden'[\s\S]+INSERT INTO public\.au_usage_mutation_versions/i,
);
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+v_requester UUID := auth\.uid\(\)[\s\S]+v_role TEXT[\s\S]+IF v_role <> 'service_role'[\s\S]+v_requester <> p_actor_user_id[\s\S]+NOT public\.is_conex_admin\(v_requester\)[\s\S]+RAISE EXCEPTION 'forbidden'[\s\S]+jsonb_typeof\(p_items\)/i,
);

// The composed wrapper must keep replay validation, reservation safety,
// legacy checkpointing, and the checked write in one transaction.
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_versioned[\s\S]+FOR UPDATE[\s\S]+admin_assert_usage_adjustment_replay[\s\S]+assert_no_active_ai_usage_reservation[\s\S]+admin_checkpoint_legacy_usage_gap[\s\S]+admin_adjust_usage_checked/i,
);
assert.match(migration, /'checkpoint_delta'\s*,\s*v_checkpoint_delta/i);

// Batch corrections must validate every replay before any checkpoint work, then
// preserve reservation guards and the checkpoint-total response contract.
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+FOR UPDATE[\s\S]+jsonb_array_elements\(p_items\)[\s\S]+admin_assert_usage_adjustment_replay[\s\S]+jsonb_array_elements\(p_items\)[\s\S]+assert_no_active_ai_usage_reservation[\s\S]+jsonb_array_elements\(p_items\)[\s\S]+admin_checkpoint_legacy_usage_gap[\s\S]+admin_adjust_usage_batch_checked/i,
);
assert.match(migration, /'checkpoint_total'\s*,\s*v_checkpoint_total/i);

// The replay assertion must still bind target/window/action/request payloads before
// the lower-level checked RPC can dedupe an existing request ID.
assert.match(
  migration,
  /admin_assert_usage_adjustment_replay\([\s\S]+p_metric_key[\s\S]+p_delta[\s\S]+p_action[\s\S]+p_window_start[\s\S]+p_window_end[\s\S]+p_request_id[\s\S]+p_context/i,
);

// Completed single-item replays are recovery of committed work. The final wrapper
// must authenticate and take the quota-window lock, validate the replay fingerprint,
// detect the persisted request, and return through the checked dedupe path before
// mutation-version, active-reservation, or checkpoint guards for new work.
assert.match(
  replayFastPathMigration,
  /IF v_role <> 'service_role'[\s\S]+pg_advisory_xact_lock[\s\S]+admin_assert_usage_adjustment_replay[\s\S]+SELECT EXISTS[\s\S]+au_usage_admin_adjustments[\s\S]+IF v_completed THEN[\s\S]+RETURN public\.admin_adjust_usage_checked[\s\S]+END IF[\s\S]+INSERT INTO public\.au_usage_mutation_versions[\s\S]+FOR UPDATE[\s\S]+assert_no_active_ai_usage_reservation[\s\S]+admin_checkpoint_legacy_usage_gap/i,
);
assert.doesNotMatch(
  replayFastPathMigration,
  /FOR UPDATE[\s\S]+IF v_completed THEN/i,
);
assert.match(
  replayFastPathMigration,
  /IF v_completed THEN[\s\S]+jsonb_build_object\('checkpoint_delta', 0\)/i,
);

// Target-derived changes remain guarded; relative increases are not unnecessarily blocked.
assert.match(migration, /IN \('decrease', 'set', 'reset'\)/i);
assert.doesNotMatch(migration, /IN \('increase',\s*'decrease',\s*'set',\s*'reset'\)/i);
assert.match(replayFastPathMigration, /IN \('decrease', 'set', 'reset'\)/i);

// Keep the public RPC surface stable and avoid destructive remediation.
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_versioned[\s\S]+TO authenticated/i);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+TO authenticated/i);
assert.match(replayFastPathMigration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_versioned[\s\S]+TO authenticated/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i);
assert.doesNotMatch(replayFastPathMigration, /\bTRUNCATE\b/i);
assert.doesNotMatch(replayFastPathMigration, /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i);

console.log('admin usage authorization/checkpoint/replay composition regressions passed');
