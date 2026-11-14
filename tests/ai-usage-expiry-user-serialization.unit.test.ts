import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260901154500_ai_usage_expiry_effective_lease_guard.sql',
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
  /v_scan_at TIMESTAMPTZ := clock_timestamp\(\)/i,
  'candidate discovery must use a wall-clock timestamp rather than transaction-stable now()',
);
assert.match(
  expiry,
  /expires_at <= v_scan_at[\s\S]+ai_usage_reservation_effective_expiry\(expires_at, provider_started_at\) <= v_scan_at/i,
  'candidate discovery must preserve the indexed raw-expiry prefilter and honor provider settlement leases',
);
assert.match(
  expiry,
  /FOR UPDATE[\s\S]+v_recheck_at := clock_timestamp\(\)[\s\S]+v_effective_expiry := public\.ai_usage_reservation_effective_expiry\([\s\S]+v_row\.expires_at[\s\S]+v_row\.provider_started_at[\s\S]+IF v_row\.expires_at > v_recheck_at OR v_effective_expiry > v_recheck_at/i,
  'candidate rows must be revalidated against raw and effective expiry after waiting on accounting locks',
);
assert.doesNotMatch(
  expiry,
  /v_row\.expires_at > now\(\)/i,
  'expiry revalidation must not regress to raw transaction-stable expiry checks',
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

console.log('AI expiry per-user accounting serialization and effective-lease regressions passed');
