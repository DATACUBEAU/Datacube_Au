import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260901164500_usage_event_user_serialization.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

assert.match(
  sql,
  /ALTER\s+FUNCTION\s+public\.track_usage_event[\s\S]*RENAME\s+TO\s+track_usage_event_user_serialized_unchecked/i,
  'the existing authoritative usage-event writer must be wrapped rather than duplicated',
);
assert.match(
  sql,
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.track_usage_event_user_serialized_unchecked[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i,
  'the internal implementation must not remain callable through PostgREST roles',
);

const authIndex = sql.indexOf('IF NOT public.has_service_role_access()');
const lockIndex = sql.indexOf("'usage_accounting_user'");
const delegateIndex = sql.indexOf('FROM public.track_usage_event_user_serialized_unchecked');
assert.ok(authIndex >= 0, 'the public wrapper must retain service-role authorization');
assert.ok(lockIndex > authIndex, 'authorization must happen before the shared accounting lock');
assert.ok(delegateIndex > lockIndex, 'the per-user accounting lock must precede delegated mutation work');

assert.match(
  sql,
  /hashtextextended\s*\(\s*concat_ws\s*\(\s*'\|'\s*,\s*'usage_accounting_user'\s*,\s*p_user_id::TEXT\s*\)\s*,\s*0\s*\)/i,
  'usage events must use the exact canonical per-user accounting lock namespace',
);
assert.match(
  sql,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.track_usage_event[\s\S]*TO\s+authenticated,\s*service_role/i,
  'the existing public RPC privilege contract must be preserved',
);
assert.doesNotMatch(
  sql,
  /\b(?:DROP|TRUNCATE)\s+TABLE\b|DELETE\s+FROM\s+public\.(?:usage_counters|usage_totals|usage_events|au_usage_events)/i,
  'serialization hardening must not destructively rewrite usage data',
);

console.log('usage event user serialization regression passed');
