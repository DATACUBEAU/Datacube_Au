import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830105000_restore_admin_usage_checkpoint_guard.sql',
  'utf8',
);

// The final single-item wrapper must keep both safety behaviors under one version lock.
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_versioned[\s\S]+FOR UPDATE[\s\S]+assert_no_active_ai_usage_reservation[\s\S]+admin_checkpoint_legacy_usage_gap[\s\S]+admin_adjust_usage_checked/i,
);
assert.match(migration, /'checkpoint_delta'\s*,\s*v_checkpoint_delta/i);

// Batch reset/corrections must validate reservations before checkpointing each item,
// then preserve the prior checkpoint-total response contract.
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+FOR UPDATE[\s\S]+jsonb_array_elements\(p_items\)[\s\S]+assert_no_active_ai_usage_reservation[\s\S]+jsonb_array_elements\(p_items\)[\s\S]+admin_checkpoint_legacy_usage_gap[\s\S]+admin_adjust_usage_batch_checked/i,
);
assert.match(migration, /'checkpoint_total'\s*,\s*v_checkpoint_total/i);

// Target-derived changes remain guarded; relative increases are not unnecessarily blocked.
assert.match(migration, /IN \('decrease', 'set', 'reset'\)/i);
assert.doesNotMatch(migration, /IN \('increase',\s*'decrease',\s*'set',\s*'reset'\)/i);

// Keep the public RPC surface stable and avoid destructive remediation.
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_versioned[\s\S]+TO authenticated/i);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+TO authenticated/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i);

console.log('admin usage checkpoint composition regressions passed');
