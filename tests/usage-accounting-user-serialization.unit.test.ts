import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260901084500_usage_accounting_user_serialization.sql',
  'utf8',
);

const reserve = migration.match(
  /CREATE OR REPLACE FUNCTION public\.reserve_ai_usage[\s\S]+?\n\$\$;/i,
)?.[0];
const single = migration.match(
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_versioned[\s\S]+?\n\$\$;/i,
)?.[0];
const batch = migration.match(
  /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+?\n\$\$;/i,
)?.[0];

assert.ok(reserve, 'serialized AI reservation wrapper must be present');
assert.ok(single, 'serialized single admin adjustment wrapper must be present');
assert.ok(batch, 'serialized batch admin adjustment wrapper must be present');

// All three entry points must acquire one identical per-user accounting lock
// before delegating to code that can touch narrower advisory/version/counter locks.
for (const body of [reserve, single, batch]) {
  assert.match(body, /usage_accounting_user/i);
  assert.match(body, /pg_advisory_xact_lock\([\s\S]+hashtextextended/i);
}

assert.match(
  reserve,
  /ai_usage_require_service_role\(\)[\s\S]+pg_advisory_xact_lock[\s\S]+reserve_ai_usage_user_serialized_unchecked/i,
);
assert.doesNotMatch(
  reserve,
  /reserve_ai_usage_user_serialized_unchecked[\s\S]+pg_advisory_xact_lock/i,
);

// Authenticated callers must be checked before they can hold the shared lock.
for (const body of [single, batch]) {
  assert.match(
    body,
    /IF v_role <> 'service_role'[\s\S]+NOT public\.is_conex_admin\(v_requester\)[\s\S]+RAISE EXCEPTION 'forbidden'[\s\S]+pg_advisory_xact_lock/i,
  );
}

assert.match(
  single,
  /pg_advisory_xact_lock[\s\S]+admin_adjust_usage_versioned_user_serialized_unchecked/i,
);
assert.match(
  batch,
  /pg_advisory_xact_lock[\s\S]+admin_adjust_usage_batch_versioned_user_serialized_unchecked/i,
);

// The renamed implementations must not remain callable through PostgREST roles.
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.reserve_ai_usage_user_serialized_unchecked[\s\S]+FROM PUBLIC, anon, authenticated, service_role/i,
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.admin_adjust_usage_versioned_user_serialized_unchecked[\s\S]+FROM PUBLIC, anon, authenticated, service_role/i,
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.admin_adjust_usage_batch_versioned_user_serialized_unchecked[\s\S]+FROM PUBLIC, anon, authenticated, service_role/i,
);

// Public contracts stay unchanged: AI reservation remains service-role only,
// while guarded Conex wrappers remain available to authenticated admins.
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.reserve_ai_usage[\s\S]+TO service_role/i,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_versioned[\s\S]+TO authenticated, service_role/i,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.admin_adjust_usage_batch_versioned[\s\S]+TO authenticated, service_role/i,
);

assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments|ai_usage_reservations)/i,
);

console.log('usage accounting per-user serialization regressions passed');
