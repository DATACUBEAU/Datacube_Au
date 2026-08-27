import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260827144000_admin_usage_adjustments_idempotency.sql',
  'utf8',
);

assert.match(sql, /ON CONFLICT \(user_id, metric_key, request_id\) DO NOTHING/i);
assert.match(sql, /IF NOT FOUND THEN[\s\S]*SELECT \* INTO v_existing[\s\S]*request_id = v_request_id/i);
assert.match(sql, /'deduped', TRUE/);
assert.doesNotMatch(sql, /ON CONFLICT[\s\S]*DO UPDATE/i);

console.log('PASS admin usage adjustment SQL is retry-safe under unique-key races');
