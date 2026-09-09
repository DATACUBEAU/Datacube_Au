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
const decreaseRequestedAmountSql = readFileSync(
  'supabase/migrations/20260901024000_admin_usage_decrease_requested_amount_fingerprint.sql',
  'utf8',
);
const resetAllRootReceiptSql = readFileSync(
  'supabase/migrations/20260904084500_admin_usage_reset_all_root_receipt.sql',
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

// Relative decreases are state-dependent because the applied delta is clamped to
// current usage. Persist and compare the submitted amount so a completed zero/clamped
// decrease can be replayed after usage changes without acquiring a new effect.
assert.match(
  usageRoute,
  /input\.action === 'decrease'[\s\S]*requested_amount:\s*amount/i,
);
assert.match(
  decreaseRequestedAmountSql,
  /v_action = 'decrease'[\s\S]+p_context ->> 'requested_amount'/i,
);
assert.match(
  decreaseRequestedAmountSql,
  /v_existing_requested_amount = v_requested_amount/i,
);
assert.match(
  decreaseRequestedAmountSql,
  /v_existing_requested_amount IS NULL AND v_existing_is_no_op/i,
);
assert.match(
  decreaseRequestedAmountSql,
  /v_existing_requested_amount IS NULL[\s\S]+NOT v_existing_is_no_op[\s\S]+v_existing\.delta = p_delta/i,
);
assert.match(
  decreaseRequestedAmountSql,
  /9007199254740991::numeric/i,
);
assert.match(
  decreaseRequestedAmountSql,
  /REVOKE EXECUTE ON FUNCTION public\.admin_assert_usage_adjustment_replay\([\s\S]*?\) FROM authenticated;/i,
);
assert.doesNotMatch(decreaseRequestedAmountSql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  decreaseRequestedAmountSql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);

// reset_all needs one durable root completion identity. Per-metric request IDs alone
// cannot prevent a lost-response retry from acquiring effects for metrics that are
// enabled later, and an empty batch otherwise has no row to dedupe against.
assert.match(
  resetAllRootReceiptSql,
  /CREATE TABLE IF NOT EXISTS public\.au_usage_admin_batch_receipts[\s\S]+UNIQUE \(user_id, action, root_request_id\)/i,
);
assert.match(
  resetAllRootReceiptSql,
  /action TEXT NOT NULL CHECK \(action = 'reset_all'\)/i,
);
assert.match(
  resetAllRootReceiptSql,
  /actor_user_id UUID NULL REFERENCES auth\.users\(id\) ON DELETE SET NULL/i,
);
assert.match(
  resetAllRootReceiptSql,
  /REVOKE ALL ON TABLE public\.au_usage_admin_batch_receipts FROM PUBLIC, anon, authenticated, service_role/i,
);
assert.match(
  resetAllRootReceiptSql,
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_reset_all_versioned/i,
);
assert.match(
  resetAllRootReceiptSql,
  /is_conex_admin\(v_requester\)[\s\S]+usage_accounting_user[\s\S]+SELECT \*[\s\S]+au_usage_admin_batch_receipts[\s\S]+FOR UPDATE/i,
);
assert.match(
  resetAllRootReceiptSql,
  /IF FOUND THEN[\s\S]+usage_adjustment_idempotency_conflict[\s\S]+RETURN jsonb_build_object\([\s\S]+'deduped', TRUE[\s\S]+'items', v_existing\.items/i,
);
assert.match(
  resetAllRootReceiptSql,
  /INSERT INTO public\.au_usage_admin_batch_receipts[\s\S]+IF jsonb_array_length\(p_items\) > 0 THEN[\s\S]+admin_adjust_usage_batch_versioned/i,
);
assert.match(
  resetAllRootReceiptSql,
  /'no_op', jsonb_array_length\(v_inserted\.items\) = 0/i,
);
assert.match(
  usageRoute,
  /admin_adjust_usage_reset_all_versioned[\s\S]+p_root_request_id:\s*rootRequestId[\s\S]+p_items:\s*items/i,
);
assert.doesNotMatch(
  usageRoute,
  /if \(items\.length > 0\) \{[\s\S]{0,500}admin_adjust_usage_batch_versioned/i,
);
assert.match(
  usageRoute,
  /batchReceipt[\s\S]+receiptItems[\s\S]+results/i,
);
assert.doesNotMatch(resetAllRootReceiptSql, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  resetAllRootReceiptSql,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments|au_usage_admin_batch_receipts)/i,
);

console.log('PASS admin usage idempotency keys are retry-safe, payload-bound, and guarded');
