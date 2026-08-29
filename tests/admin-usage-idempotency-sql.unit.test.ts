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

console.log('PASS admin usage idempotency keys are retry-safe, payload-bound, and guarded');
