import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831024500_admin_usage_delta_magnitude_guard.sql',
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

// Keep rollout non-destructive and enforce the constraint on new writes without
// requiring a potentially blocking historical-table validation in this PR.
assert.match(migration, /ADD CONSTRAINT[\s\S]+NOT VALID/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

console.log('admin usage delta magnitude regressions passed');
