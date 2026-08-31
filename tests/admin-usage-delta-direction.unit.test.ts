import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831004500_admin_usage_delta_direction_guard.sql',
  'utf8',
);
const batchMigration = readFileSync(
  'supabase/migrations/20260827215500_admin_usage_adjustments_concurrency.sql',
  'utf8',
);

// Relative actions must match the sign of their immutable audit label at the
// shared SQL boundary, before locks, replay handling, or ledger mutation.
assert.match(
  migration,
  /v_action = 'increase' AND p_delta <= 0[\s\S]+v_action = 'decrease' AND p_delta >= 0[\s\S]+invalid_usage_adjustment_direction/i,
);
assert.match(
  migration,
  /invalid_usage_adjustment_direction[\s\S]+pg_advisory_xact_lock[\s\S]+INSERT INTO public\.au_usage_admin_adjustments/i,
);

// Target-style set/reset operations retain signed-delta flexibility, including
// legitimate zero no-ops, rather than inheriting the relative-action rule.
assert.match(migration, /IF p_delta = 0[\s\S]+no_op[\s\S]+'delta', 0/i);
assert.doesNotMatch(migration, /v_action = 'set' AND p_delta/i);
assert.doesNotMatch(migration, /v_action = 'reset' AND p_delta/i);

// Batch writes delegate each item to the same checked implementation, so the
// invariant cannot be bypassed through reset-all or internal batch composition.
assert.match(
  batchMigration,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_checked[\s\S]+admin_adjust_usage_checked\([\s\S]+v_item->>'delta'[\s\S]+v_item->>'action'/i,
);

// Keep the checked implementation internal; authenticated callers must use the
// versioned wrappers that also enforce replay, reservation, checkpoint, and version guards.
assert.match(
  migration,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage_checked[\s\S]+FROM authenticated/i,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_checked[\s\S]+TO service_role/i,
);

assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

console.log('admin usage delta-direction regressions passed');
