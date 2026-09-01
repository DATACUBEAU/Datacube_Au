import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260901034500_admin_usage_request_id_serialization.sql',
  'utf8',
);

const checkedStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_adjust_usage_checked');
const singleStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_adjust_usage_versioned');
const batchStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_adjust_usage_batch_versioned');

assert.ok(checkedStart >= 0);
assert.ok(singleStart > checkedStart);
assert.ok(batchStart > singleStart);

const checked = sql.slice(checkedStart, singleStart);
const single = sql.slice(singleStart, batchStart);
const batch = sql.slice(batchStart);

for (const body of [checked, single]) {
  const requestLock = body.indexOf("'admin_usage_request'");
  const windowLock = body.indexOf("p_window_start::TEXT");
  const replay = body.indexOf('admin_assert_usage_adjustment_replay');
  assert.ok(requestLock >= 0, 'request-id advisory lock must exist');
  assert.ok(windowLock > requestLock, 'request-id lock must be acquired before quota-window lock');
  assert.ok(replay > windowLock, 'replay validation must happen after both serialization locks');
}

assert.match(
  checked,
  /SELECT \* INTO v_existing[\s\S]+IF FOUND THEN[\s\S]+admin_assert_usage_adjustment_replay/i,
);
assert.match(
  checked,
  /ON CONFLICT \(user_id, metric_key, request_id\) DO NOTHING[\s\S]+admin_assert_usage_adjustment_replay/i,
);

const batchRequestLock = batch.indexOf("'admin_usage_request'");
const batchWindowLock = batch.indexOf("value ->> 'windowStart'");
const batchReplay = batch.indexOf('admin_assert_usage_adjustment_replay');
assert.ok(batchRequestLock >= 0);
assert.ok(batchWindowLock > batchRequestLock, 'batch request keys must lock before quota windows');
assert.ok(batchReplay > batchWindowLock, 'batch replay validation must occur after deterministic locks');
assert.match(batch, /SELECT DISTINCT hashtextextended[\s\S]+ORDER BY lock_key/);
assert.match(batch, /WHERE NULLIF\(TRIM\(COALESCE\(value ->> 'requestId'/);

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

console.log('PASS admin usage request IDs serialize across quota windows and revalidate races');
