import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831024500_admin_usage_delta_magnitude_guard.sql',
  'utf8',
);
const cumulativeMigration = readFileSync(
  'supabase/migrations/20260831125500_admin_usage_cumulative_safe_integer_guard.sql',
  'utf8',
);

// Persisted admin deltas must remain inside JavaScript's exact integer range so
// PostgreSQL enforcement and TypeScript usage presentation cannot diverge on
// values the application cannot faithfully represent.
assert.match(
  migration,
  /delta\s*>=\s*-9007199254740991[\s\S]+delta\s*<=\s*9007199254740991/i,
);
assert.match(
  migration,
  /au_usage_admin_adjustments_delta_safe_integer_chk[\s\S]+CHECK\s*\(/i,
);

// Multiple individually valid deltas can still overflow the application's exact
// integer range. Guard the cumulative window total under the same advisory lock
// identity used by the checked adjustment path, immediately before persistence.
assert.match(
  cumulativeMigration,
  /pg_advisory_xact_lock[\s\S]+NEW\.user_id[\s\S]+NEW\.metric_key[\s\S]+NEW\.window_start[\s\S]+NEW\.window_end/i,
);
assert.match(
  cumulativeMigration,
  /SELECT\s+COALESCE\(SUM\(delta\),\s*0\)[\s\S]+v_next_total\s*:=\s*v_total\s*\+\s*NEW\.delta/i,
);
assert.match(
  cumulativeMigration,
  /v_next_total\s*<\s*-9007199254740991[\s\S]+v_next_total\s*>\s*9007199254740991/i,
);
assert.match(
  cumulativeMigration,
  /BEFORE\s+INSERT\s+ON\s+public\.au_usage_admin_adjustments/i,
);
assert.match(cumulativeMigration, /usage_adjustment_total_out_of_range/i);
assert.match(
  cumulativeMigration,
  /REVOKE\s+EXECUTE[\s\S]+FROM\s+authenticated/i,
);

// Keep rollout non-destructive and enforce bounds without rewriting usage history.
assert.match(migration, /ADD CONSTRAINT[\s\S]+NOT VALID/i);
for (const sql of [migration, cumulativeMigration]) {
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(
    sql,
    /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
  );
}

console.log('admin usage delta magnitude regressions passed');
