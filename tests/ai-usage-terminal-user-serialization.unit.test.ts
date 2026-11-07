import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260901104500_ai_usage_terminal_user_serialization.sql',
  'utf8',
);

const begin = migration.match(
  /CREATE OR REPLACE FUNCTION public\.begin_ai_usage_reservation[\s\S]+?\n\$\$;/i,
)?.[0];
const commit = migration.match(
  /CREATE OR REPLACE FUNCTION public\.commit_ai_usage[\s\S]+?\n\$\$;/i,
)?.[0];
const release = migration.match(
  /CREATE OR REPLACE FUNCTION public\.release_ai_usage[\s\S]+?\n\$\$;/i,
)?.[0];

assert.ok(begin, 'serialized begin wrapper must be present');
assert.ok(commit, 'serialized commit wrapper must be present');
assert.ok(release, 'serialized release wrapper must be present');

for (const [name, body] of [
  ['begin', begin],
  ['commit', commit],
  ['release', release],
] as const) {
  assert.match(body, /ai_usage_require_service_role\(\)/i, `${name} must authenticate`);
  assert.match(body, /usage_accounting_user/i, `${name} must use canonical user lock namespace`);
  assert.match(body, /pg_advisory_xact_lock\([\s\S]+hashtextextended/i, `${name} must use xact advisory lock`);
  assert.match(
    body,
    /ai_usage_require_service_role\(\)[\s\S]+pg_advisory_xact_lock/i,
    `${name} must authenticate before taking the shared accounting lock`,
  );
}

assert.match(
  begin,
  /pg_advisory_xact_lock[\s\S]+begin_ai_usage_reservation_user_serialized_unchecked/i,
);
assert.match(
  commit,
  /pg_advisory_xact_lock[\s\S]+commit_ai_usage_user_serialized_unchecked/i,
);
assert.match(
  release,
  /pg_advisory_xact_lock[\s\S]+release_ai_usage_user_serialized_unchecked/i,
);

// Renamed implementations must not remain independently callable through
// PostgREST/service-role. All callers go through the guarded public wrappers.
for (const fn of [
  'begin_ai_usage_reservation_user_serialized_unchecked',
  'commit_ai_usage_user_serialized_unchecked',
  'release_ai_usage_user_serialized_unchecked',
]) {
  assert.match(
    migration,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]+FROM PUBLIC, anon, authenticated, service_role`, 'i'),
  );
}

for (const fn of ['begin_ai_usage_reservation', 'commit_ai_usage', 'release_ai_usage']) {
  assert.match(
    migration,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]+TO service_role`, 'i'),
  );
}

// The multi-user expiry reaper requires deterministic per-user locking inside
// its own batch and must not be silently renamed/wrapped by this single-user change.
assert.doesNotMatch(migration, /ALTER FUNCTION public\.expire_ai_usage_reservations/i);

assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments|ai_usage_reservations)/i,
);

console.log('AI terminal per-user accounting serialization regressions passed');
