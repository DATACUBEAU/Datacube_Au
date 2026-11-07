import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830075500_admin_usage_inflight_reservation_guard.sql',
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.assert_no_active_ai_usage_reservation/i);
assert.match(migration, /FROM public\.ai_usage_reservations AS r/i);
assert.match(migration, /r\.user_id = p_user_id/i);
assert.match(migration, /r\.status = 'reserved'/i);
assert.match(migration, /r\.expires_at > now\(\)/i);
assert.match(migration, /ai_usage_jsonb_numeric_value[\s\S]+reserved_units[\s\S]+p_metric_key/i);
assert.match(migration, /usage_reservation_in_flight/i);
assert.match(migration, /ERRCODE = '40001'/i);

// Relative increases are independent of the provisional baseline. Target-derived
// decrease/set/reset writes must wait until matching reservations settle.
assert.match(
  migration,
  /p_action[\s\S]+IN \('decrease', 'set', 'reset'\)[\s\S]+assert_no_active_ai_usage_reservation/i,
);

// reset_all uses the batch RPC and therefore must receive the same guard per item.
assert.match(
  migration,
  /jsonb_array_elements\(p_items\)[\s\S]+v_action IN \('decrease', 'set', 'reset'\)[\s\S]+assert_no_active_ai_usage_reservation/i,
);

// The internal assertion is not an externally callable privilege surface.
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.assert_no_active_ai_usage_reservation\(UUID, TEXT\) FROM anon, authenticated, service_role/i,
);

// Guard migration must not mutate or delete product usage history.
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|ai_usage_reservations)/i);

console.log('admin in-flight reservation guard regressions passed');
