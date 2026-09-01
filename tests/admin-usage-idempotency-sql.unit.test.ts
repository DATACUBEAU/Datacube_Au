import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseSql = readFileSync(
  'supabase/migrations/20260827144000_admin_usage_adjustments_idempotency.sql',
  'utf8',
);
const replaySql = readFileSync(
  'supabase/migrations/20260828074000_admin_usage_request_fingerprint.sql',
  'utf8',
);
const legacyRpcRevokeSql = readFileSync(
  'supabase/migrations/20260829204500_revoke_legacy_admin_usage_rpc.sql',
  'utf8',
);
const internalRpcRevokeSql = readFileSync(
  'supabase/migrations/20260829211500_revoke_internal_admin_usage_rpcs.sql',
  'utf8',
);
const batchRequestGuardSql = readFileSync(
  'supabase/migrations/20260831204500_admin_usage_batch_request_id_guard.sql',
  'utf8',
);
const noOpReceiptSql = readFileSync(
  'supabase/migrations/20260831214500_admin_usage_noop_idempotency_receipt.sql',
  'utf8',
);
const noOpReceiptConstraintSql = readFileSync(
  'supabase/migrations/20260831224000_admin_usage_noop_receipt_constraint.sql',
  'utf8',
);
const decreaseNoOpReceiptSql = readFileSync(
  'supabase/migrations/20260901014500_admin_usage_decrease_noop_receipt.sql',
  'utf8',
);
const usageRoute = readFileSync(
  'src/app/api/admin/limits/user-usage/route.ts',
  'utf8',
);

assert.match(baseSql, /ON CONFLICT \(user_id, metric_key, request_id\) DO NOTHING/i);
assert.match(baseSql, /IF NOT FOUND THEN[\s\S]*SELECT \* INTO v_existing[\s\S]*request_id = v_request_id/i);
assert.match(baseSql, /'deduped', TRUE/);
assert.doesNotMatch(baseSql, /ON CONFLICT[\s\S]*DO UPDATE/i);

assert.match(replaySql, /CREATE OR REPLACE FUNCTION public\.admin_assert_usage_adjustment_replay/i);
assert.match(replaySql, /v_existing\.action <> v_action/i);
assert.match(replaySql, /v_existing\.window_start <> p_window_start/i);
assert.match(replaySql, /v_existing\.window_end IS NOT DISTINCT FROM p_window_end/i);
assert.match(replaySql, /v_action IN \('increase', 'decrease'\)[\s\S]*v_existing\.delta <> p_delta/i);
assert.match(replaySql, /v_action IN \('set', 'reset'\)[\s\S]*v_existing_target IS DISTINCT FROM v_requested_target/i);
assert.match(replaySql, /usage_adjustment_idempotency_conflict/i);
assert.match(
  replaySql,
  /admin_assert_usage_adjustment_replay\([\s\S]*?p_target_user_id,[\s\S]*?p_metric_key,[\s\S]*?p_delta,[\s\S]*?p_action/i,
);
assert.match(
  replaySql,
  /Validate every scoped retry key before creating any checkpoint event[\s\S]*admin_assert_usage_adjustment_replay[\s\S]*admin_checkpoint_legacy_usage_gap/i,
);

assert.match(
  legacyRpcRevokeSql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage\([\s\S]*?\) FROM authenticated;/i,
);
assert.doesNotMatch(
  legacyRpcRevokeSql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage\([\s\S]*?\) TO authenticated;/i,
);
assert.match(
  legacyRpcRevokeSql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage\([\s\S]*?\) TO service_role;/i,
);

assert.match(
  internalRpcRevokeSql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage_checked\([\s\S]*?\) FROM authenticated;/i,
);
assert.match(
  internalRpcRevokeSql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_checked\([\s\S]*?\) FROM authenticated;/i,
);
assert.doesNotMatch(
  internalRpcRevokeSql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_checked\([\s\S]*?\) TO authenticated;/i,
);
assert.doesNotMatch(
  internalRpcRevokeSql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_checked\([\s\S]*?\) TO authenticated;/i,
);
assert.match(
  internalRpcRevokeSql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_checked\([\s\S]*?\) TO service_role;/i,
);
assert.match(
  internalRpcRevokeSql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_checked\([\s\S]*?\) TO service_role;/i,
);

assert.match(
  batchRequestGuardSql,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_checked[\s\S]+IF EXISTS \([\s\S]+jsonb_array_elements\(p_items\)[\s\S]+GROUP BY[\s\S]+metricKey[\s\S]+requestId[\s\S]+HAVING COUNT\(\*\) > 1[\s\S]+usage_adjustment_batch_duplicate_request_id[\s\S]+FOR v_item IN/i,
);
assert.match(
  batchRequestGuardSql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_checked\([\s\S]*?\) FROM authenticated;/i,
);
assert.match(
  batchRequestGuardSql,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_checked\([\s\S]*?\) TO service_role;/i,
);
assert.doesNotMatch(batchRequestGuardSql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  batchRequestGuardSql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

assert.match(
  noOpReceiptSql,
  /p_delta = 0 AND v_action NOT IN \('set', 'reset'\)[\s\S]+INSERT INTO public\.au_usage_admin_adjustments/i,
);
assert.doesNotMatch(
  noOpReceiptSql,
  /IF p_delta = 0 THEN\s+RETURN jsonb_build_object/i,
);
assert.match(
  noOpReceiptSql,
  /WHEN p_delta = 0 THEN jsonb_build_object\('no_op', TRUE\)/i,
);
assert.match(
  noOpReceiptSql,
  /'deduped', TRUE,[\s\S]+'no_op', v_existing\.delta = 0/i,
);
assert.match(
  noOpReceiptSql,
  /ON CONFLICT \(user_id, metric_key, request_id\) DO NOTHING/i,
);
assert.match(
  noOpReceiptSql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage_checked\([\s\S]*?\) FROM authenticated;/i,
);
assert.doesNotMatch(noOpReceiptSql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  noOpReceiptSql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

assert.match(
  noOpReceiptConstraintSql,
  /DROP CONSTRAINT IF EXISTS au_usage_admin_adjustments_delta_check/i,
);
assert.match(
  noOpReceiptConstraintSql,
  /ADD CONSTRAINT au_usage_admin_adjustments_delta_check[\s\S]+delta <> 0[\s\S]+delta = 0[\s\S]+action IN \('set', 'reset'\)[\s\S]+context @> '\{"no_op": true\}'::jsonb/i,
);
assert.doesNotMatch(noOpReceiptConstraintSql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  noOpReceiptConstraintSql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

// A decrease at zero usage is state-dependent: the same request replayed after
// new usage accrues must recover the original no-op instead of acquiring a new
// negative effect. Persist the original completion with truthful action semantics.
assert.match(
  decreaseNoOpReceiptSql,
  /ADD CONSTRAINT au_usage_admin_adjustments_delta_check[\s\S]+delta = 0[\s\S]+action IN \('decrease', 'set', 'reset'\)[\s\S]+context @> '\{"no_op": true\}'::jsonb/i,
);
assert.match(
  decreaseNoOpReceiptSql,
  /v_action = 'decrease' AND p_delta > 0/i,
);
assert.match(
  decreaseNoOpReceiptSql,
  /p_delta = 0 AND v_action NOT IN \('decrease', 'set', 'reset'\)/i,
);
assert.match(
  decreaseNoOpReceiptSql,
  /WHEN p_delta = 0 THEN jsonb_build_object\('no_op', TRUE\)/i,
);
assert.match(
  decreaseNoOpReceiptSql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_adjust_usage_checked\([\s\S]*?\) FROM authenticated;/i,
);
assert.doesNotMatch(decreaseNoOpReceiptSql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  decreaseNoOpReceiptSql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);
assert.match(
  usageRoute,
  /delta === 0 && input\.action === 'increase'[\s\S]+admin_adjust_usage_versioned/i,
);
assert.doesNotMatch(
  usageRoute,
  /delta === 0 && \(input\.action === 'increase' \|\| input\.action === 'decrease'\)/i,
);

console.log('PASS admin usage idempotency keys are retry-safe, payload-bound, and guarded');
