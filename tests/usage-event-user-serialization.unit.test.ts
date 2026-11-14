import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260901164500_usage_event_user_serialization.sql',
);
const canonicalPath = path.join(
  process.cwd(),
  'supabase/migrations/20260315113000_limits_usage_tracking_enforcement.sql',
);
const callerPath = path.join(process.cwd(), 'src/lib/server/usage-tracking.ts');

const sql = fs.readFileSync(migrationPath, 'utf8');
const canonicalSql = fs.readFileSync(canonicalPath, 'utf8');
const caller = fs.readFileSync(callerPath, 'utf8');

const canonicalSignature = /track_usage_event\s*\(\s*UUID\s*,\s*TEXT\s*,\s*TEXT\s*,\s*TEXT\s*,\s*JSONB\s*,\s*TEXT\s*,\s*TEXT\s*,\s*JSONB\s*,\s*TIMESTAMPTZ\s*\)/i;
assert.match(
  canonicalSql,
  canonicalSignature,
  'the historical migration must establish the canonical nine-parameter usage-event RPC',
);
assert.match(
  sql,
  /ALTER\s+FUNCTION\s+public\.track_usage_event\s*\(\s*UUID\s*,\s*TEXT\s*,\s*TEXT\s*,\s*TEXT\s*,\s*JSONB\s*,\s*TEXT\s*,\s*TEXT\s*,\s*JSONB\s*,\s*TIMESTAMPTZ\s*\)[\s\S]*RENAME\s+TO\s+track_usage_event_user_serialized_unchecked/i,
  'serialization must wrap the exact canonical usage-event overload rather than a parallel/legacy signature',
);
assert.doesNotMatch(
  sql,
  /track_usage_event\s*\(\s*UUID\s*,\s*TEXT\s*,\s*NUMERIC\s*,\s*TEXT\s*,\s*JSONB\s*\)/i,
  'serialization must not target the obsolete five-argument delta-style contract',
);
assert.match(
  sql,
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.track_usage_event_user_serialized_unchecked[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i,
  'the internal implementation must not remain callable through PostgREST roles',
);

const userValidationIndex = sql.indexOf('IF p_user_id IS NULL');
const roleIndex = sql.indexOf("v_role <> 'service_role'");
const ownUserIndex = sql.indexOf('v_requester <> p_user_id');
const adminIndex = sql.indexOf('public.is_conex_admin(v_requester)');
const lockIndex = sql.indexOf("'usage_accounting_user'");
const delegateIndex = sql.indexOf('RETURN public.track_usage_event_user_serialized_unchecked');
assert.ok(userValidationIndex >= 0, 'the public wrapper must retain required-user validation');
assert.ok(roleIndex > userValidationIndex, 'authorization must follow required-user validation');
assert.ok(ownUserIndex > roleIndex, 'authenticated own-user authorization must be preserved');
assert.ok(adminIndex > ownUserIndex, 'Conex-admin authorization must be preserved');
assert.ok(lockIndex > adminIndex, 'authorization must happen before the shared accounting lock');
assert.ok(delegateIndex > lockIndex, 'the per-user accounting lock must precede delegated mutation work');

assert.match(
  sql,
  /hashtextextended\s*\(\s*concat_ws\s*\(\s*'\|'\s*,\s*'usage_accounting_user'\s*,\s*p_user_id::TEXT\s*\)\s*,\s*0\s*\)/i,
  'usage events must use the exact canonical per-user accounting lock namespace',
);
assert.match(
  sql,
  /p_occurred_at\s+TIMESTAMPTZ\s+DEFAULT\s+now\(\)/i,
  'the canonical optional occurred-at argument must be preserved',
);
assert.match(
  sql,
  /RETURNS\s+JSONB/i,
  'the canonical JSONB return contract must be preserved',
);
assert.match(
  sql,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.track_usage_event[\s\S]*TO\s+authenticated,\s*service_role/i,
  'the existing public RPC privilege contract must be preserved',
);

for (const argument of [
  'p_user_id',
  'p_event_key',
  'p_feature',
  'p_source',
  'p_metrics',
  'p_request_id',
  'p_correlation_id',
  'p_context',
]) {
  assert.match(
    caller,
    new RegExp(`${argument}\\s*:`),
    `the server caller must continue using canonical named argument ${argument}`,
  );
}
assert.doesNotMatch(
  caller,
  /p_delta\s*:/,
  'the server caller must not drift to the obsolete delta-style RPC contract',
);

assert.doesNotMatch(
  sql,
  /\b(?:DROP|TRUNCATE)\s+TABLE\b|DELETE\s+FROM\s+public\.(?:usage_counters|usage_totals|usage_events|au_usage_events)/i,
  'serialization hardening must not destructively rewrite usage data',
);

console.log('usage event user serialization regression passed');
