import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260901064500_admin_usage_reason_replay_fingerprint.sql',
  'utf8',
);

assert.match(sql, /v_reason TEXT := NULLIF\(TRIM\(COALESCE\(p_reason, ''\)\), ''\)/);
assert.match(sql, /IF v_existing\.reason IS DISTINCT FROM v_reason THEN[\s\S]+usage_adjustment_idempotency_conflict/);

const reasonChecks = sql.match(/v_existing\.reason IS DISTINCT FROM v_reason/g) ?? [];
assert.equal(
  reasonChecks.length,
  2,
  'reason fingerprint must be checked both for existing-row fast replay and insert-conflict fallback',
);

const existingLookup = sql.indexOf('SELECT * INTO v_existing');
const firstReasonCheck = sql.indexOf('v_existing.reason IS DISTINCT FROM v_reason');
const firstReplayCheck = sql.indexOf('admin_assert_usage_adjustment_replay');
assert.ok(existingLookup >= 0);
assert.ok(firstReasonCheck > existingLookup, 'reason must be compared after loading the persisted audit row');
assert.ok(firstReplayCheck > firstReasonCheck, 'reason mismatch must fail before deduplicated replay success');

assert.match(
  sql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage_checked\([\s\S]*?\) FROM authenticated;/i,
);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_checked\([\s\S]*?\) TO service_role;/i,
);
assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  sql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

console.log('PASS admin usage idempotency binds retries to the immutable audit reason');
