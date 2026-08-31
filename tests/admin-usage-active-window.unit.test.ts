import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831034500_admin_usage_active_window_guard.sql',
  'utf8',
);

// Finite adjustment windows must still be active at the authoritative persistence
// boundary, preventing stale/future corrections from being stored after an API race.
assert.match(
  migration,
  /IF NEW\.window_end IS NOT NULL[\s\S]+NEW\.window_end <= NEW\.window_start[\s\S]+v_now < NEW\.window_start OR v_now >= NEW\.window_end[\s\S]+usage_adjustment_window_stale/i,
);
assert.match(
  migration,
  /BEFORE INSERT OR UPDATE OF window_start, window_end[\s\S]+ON public\.au_usage_admin_adjustments/i,
);

// Lifetime/never windows remain compatible by intentionally allowing NULL end bounds.
assert.match(migration, /IF NEW\.window_end IS NOT NULL THEN/i);

// The guard is not an alternate mutation surface for authenticated callers.
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.assert_admin_usage_adjustment_active_window\(\) FROM PUBLIC, anon, authenticated/i,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.assert_admin_usage_adjustment_active_window\(\) TO service_role/i,
);

assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

console.log('admin usage active-window regressions passed');
