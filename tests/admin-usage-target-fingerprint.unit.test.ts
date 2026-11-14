import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260901074500_admin_usage_target_replay_fingerprint.sql',
  'utf8',
);

assert.match(
  sql,
  /v_action IN \('set', 'reset'\)[\s\S]+v_requested_target IS NOT NULL[\s\S]+v_requested_target::numeric/i,
);
assert.match(
  sql,
  /v_requested_target_numeric < 0[\s\S]+v_requested_target_numeric <> trunc\(v_requested_target_numeric\)[\s\S]+9007199254740991::numeric/i,
);
assert.match(
  sql,
  /v_action = 'reset' AND v_requested_target_numeric <> 0/i,
);
assert.match(
  sql,
  /IF NOT FOUND THEN[\s\S]+v_action IN \('set', 'reset'\) AND v_requested_target IS NULL[\s\S]+usage_adjustment_requested_target_required/i,
);
assert.match(
  sql,
  /v_existing_target IS NOT NULL[\s\S]+v_requested_target IS NOT NULL[\s\S]+v_existing_target = v_requested_target/i,
);
assert.match(
  sql,
  /v_existing_target IS NULL[\s\S]+v_requested_target IS NULL[\s\S]+v_existing\.delta = p_delta/i,
);
assert.match(sql, /usage_adjustment_idempotency_conflict/i);
assert.match(
  sql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_assert_usage_adjustment_replay\([\s\S]*?\) FROM authenticated;/i,
);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.admin_assert_usage_adjustment_replay\([\s\S]*?\) TO service_role;/i,
);
assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  sql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

console.log('PASS set/reset usage adjustments require payload-bound target fingerprints');
