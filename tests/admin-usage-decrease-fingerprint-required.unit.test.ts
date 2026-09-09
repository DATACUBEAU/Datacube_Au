import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260901094500_admin_usage_decrease_requested_amount_required.sql',
  'utf8',
);

assert.match(
  sql,
  /IF v_action = 'decrease' AND v_requested_amount IS NULL THEN[\s\S]+usage_adjustment_requested_amount_required/i,
);
assert.match(
  sql,
  /Decrease operations require an immutable requested_amount fingerprint/i,
);
assert.match(
  sql,
  /IF NOT FOUND THEN[\s\S]+v_action = 'decrease'[\s\S]+v_requested_amount IS NULL[\s\S]+RETURN;/i,
);
assert.match(
  sql,
  /v_existing_requested_amount IS NULL AND v_existing_is_no_op/i,
);
assert.match(
  sql,
  /v_existing_requested_amount IS NULL[\s\S]+NOT v_existing_is_no_op[\s\S]+v_existing\.delta = p_delta/i,
);
assert.match(sql, /9007199254740991::numeric/i);
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

console.log('PASS new decrease adjustments require immutable requested-amount fingerprints');
