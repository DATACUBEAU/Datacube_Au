import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830114000_restore_admin_usage_replay_guard.sql',
  'utf8',
);

// The final single-item wrapper must keep replay validation, reservation safety,
// legacy checkpointing, and the checked write under one usage-version lock.
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

// Target-derived changes remain guarded; relative increases are not unnecessarily blocked.
assert.match(migration, /IN \('decrease', 'set', 'reset'\)/i);
assert.doesNotMatch(migration, /IN \('increase',\s*'decrease',\s*'set',\s*'reset'\)/i);

// Keep the public RPC surface stable and avoid destructive remediation.
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_versioned[\s\S]+TO authenticated/i);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+TO authenticated/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i);

console.log('admin usage checkpoint/replay composition regressions passed');
