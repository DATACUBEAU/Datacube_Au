import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831044500_usage_window_wall_clock_freshness.sql',
  'utf8',
);

// Freshness must use actual execution time rather than PostgreSQL's stable
// transaction timestamp, otherwise a lock wait can carry an old window past reset.
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.assert_admin_usage_adjustment_active_window\(\)[\s\S]+v_wall_clock TIMESTAMPTZ := clock_timestamp\(\)[\s\S]+v_wall_clock < NEW\.window_start OR v_wall_clock >= NEW\.window_end/i,
);

// Reservation admission must capture the wall clock after daily/lifetime
// serialization and only then validate genuinely new finite-window admissions.
assert.match(
  migration,
  /SELECT counters INTO v_locked_today[\s\S]+FOR UPDATE;[\s\S]+SELECT counters INTO v_locked_total[\s\S]+FOR UPDATE;[\s\S]+SELECT \* INTO v_existing[\s\S]+IF FOUND THEN[\s\S]+ELSE[\s\S]+v_wall_clock := clock_timestamp\(\);[\s\S]+USAGE_WINDOW_STALE/i,
);

// Exact existing reservation replays remain recoverable across reset boundaries.
assert.match(
  migration,
  /IF FOUND THEN[\s\S]+v_forward_ticket_id := NULL;[\s\S]+v_forward_expires_at := v_existing\.expires_at;[\s\S]+ELSE[\s\S]+v_wall_clock := clock_timestamp\(\)/i,
);

// The public reservation boundary stays service-role only.
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.reserve_ai_usage\([\s\S]+FROM PUBLIC, anon, authenticated;[\s\S]+GRANT EXECUTE ON FUNCTION public\.reserve_ai_usage\([\s\S]+TO service_role;/i,
);

assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

console.log('usage window wall-clock freshness regressions passed');
