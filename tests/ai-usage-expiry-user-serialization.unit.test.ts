import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260901124500_ai_usage_expiry_user_serialization.sql',
  'utf8',
);

const expiry = migration.match(
  /CREATE OR REPLACE FUNCTION public\.expire_ai_usage_reservations[\s\S]+?\n\$\$;/i,
)?.[0];

assert.ok(expiry, 'serialized expiry reaper must be present');
assert.match(expiry, /ai_usage_require_service_role\(\)/i, 'expiry must authenticate');
assert.match(expiry, /usage_accounting_user/i, 'expiry must use canonical user lock namespace');
assert.match(
  expiry,
  /SELECT DISTINCT r\.user_id[\s\S]+ORDER BY r\.user_id[\s\S]+pg_advisory_xact_lock/i,
  'candidate user locks must be acquired in deterministic user order',
);
assert.match(
  expiry,
  /ai_usage_require_service_role\(\)[\s\S]+pg_advisory_xact_lock/i,
  'service-role authorization must occur before accounting locks',
);
assert.match(
  expiry,
  /pg_advisory_xact_lock[\s\S]+INSERT INTO public\.usage_counters/i,
  'outer user locks must be acquired before daily counter creation/locking',
);
assert.match(
  expiry,
  /pg_advisory_xact_lock[\s\S]+INSERT INTO public\.usage_totals/i,
  'outer user locks must be acquired before lifetime counter creation/locking',
);
assert.match(
  expiry,
  /pg_advisory_xact_lock[\s\S]+FROM public\.ai_usage_reservations[\s\S]+FOR UPDATE/i,
  'outer user locks must precede reservation row locks',
);
assert.match(
  expiry,
  /IF NOT FOUND OR v_row\.status <> 'reserved' OR v_row\.expires_at > now\(\)[\s\S]+CONTINUE/i,
  'candidate rows must be revalidated after waiting on accounting locks',
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.expire_ai_usage_reservations\(INTEGER\) FROM PUBLIC, anon, authenticated/i,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.expire_ai_usage_reservations\(INTEGER\) TO service_role/i,
);

assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments|ai_usage_reservations)/i,
);

console.log('AI expiry per-user accounting serialization regressions passed');
