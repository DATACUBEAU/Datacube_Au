import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830144500_ai_usage_provider_started_expiry.sql',
  'utf8',
);
const leaseRefreshMigration = readFileSync(
  'supabase/migrations/20260830154500_ai_usage_attempt_lease_refresh.sql',
  'utf8',
);
const sameTicketGuardMigration = readFileSync(
  'supabase/migrations/20260831014500_ai_usage_same_ticket_takeover_guard.sql',
  'utf8',
);
const rolloutBackfillMigration = readFileSync(
  'supabase/migrations/20260831064500_ai_usage_effective_expiry_backfill.sql',
  'utf8',
);
const beginWallClockMigration = readFileSync(
  'supabase/migrations/20260831084500_ai_usage_begin_wall_clock_freshness.sql',
  'utf8',
);

assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.ai_usage_reservation_effective_expiry[\s\S]+GREATEST\(p_expires_at, p_provider_started_at \+ interval '15 minutes'\)/,
  'provider-started reservations must receive a bounded settlement lease',
);

const beginStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.begin_ai_usage_reservation');
const expireStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.expire_ai_usage_reservations');
const guardStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.assert_no_active_ai_usage_reservation');
assert.ok(beginStart >= 0 && expireStart > beginStart && guardStart > expireStart);

const begin = migration.slice(beginStart, expireStart);
assert.match(begin, /ai_usage_reservation_effective_expiry\([\s\S]+v_row\.expires_at,[\s\S]+v_row\.provider_started_at/);
assert.match(begin, /IF v_row\.status = 'reserved' AND v_effective_expiry <= now\(\) THEN/);
assert.doesNotMatch(begin, /v_row\.status = 'reserved' AND v_row\.expires_at <= now\(\)/);

const expiry = migration.slice(expireStart, guardStart);
assert.match(expiry, /WHERE status = 'reserved'[\s\S]+ai_usage_reservation_effective_expiry\(expires_at, provider_started_at\) <= now\(\)/);
assert.match(expiry, /FOR UPDATE;[\s\S]+v_effective_expiry := public\.ai_usage_reservation_effective_expiry/);
assert.match(expiry, /IF v_effective_expiry > now\(\) THEN[\s\S]+CONTINUE;/);
assert.match(expiry, /FROM public\.usage_counters[\s\S]+FOR UPDATE;[\s\S]+FROM public\.usage_totals[\s\S]+FOR UPDATE;[\s\S]+FROM public\.ai_usage_reservations[\s\S]+FOR UPDATE;/);

const guard = migration.slice(guardStart);
assert.match(guard, /WHERE r\.user_id = p_user_id[\s\S]+r\.status = 'reserved'[\s\S]+reserved_units/);
assert.doesNotMatch(guard, /r\.expires_at > now\(\)/, 'all still-reserved rows must block target corrections');

// Accepted provider retries/takeovers must refresh the durable expiry itself.
assert.match(
  leaseRefreshMigration,
  /CREATE OR REPLACE FUNCTION public\.begin_ai_usage_reservation/,
);
assert.match(
  leaseRefreshMigration,
  /v_row\.last_attempt_at IS NOT NULL[\s\S]+v_row\.last_attempt_at > now\(\) - interval '2 minutes'/,
  'retry suppression must be based on the latest accepted attempt',
);
assert.match(
  leaseRefreshMigration,
  /expires_at = GREATEST\(expires_at, v_attempt_started_at \+ interval '15 minutes'\)/,
  'every accepted provider attempt must receive a full durable settlement lease',
);
assert.match(
  leaseRefreshMigration,
  /provider_started_at = COALESCE\(provider_started_at, v_attempt_started_at\)/,
  'the first provider-start timestamp should remain available for auditability',
);
assert.match(
  leaseRefreshMigration,
  /last_attempt_at = v_attempt_started_at/,
  'the latest attempt timestamp must be persisted separately',
);
assert.match(
  leaseRefreshMigration,
  /'expires_at', v_row\.expires_at/,
  'begin response should expose the refreshed lease boundary for observability',
);

// Rows accepted during rolling deployment can predate the durable lease refresh.
assert.match(
  rolloutBackfillMigration,
  /UPDATE public\.ai_usage_reservations AS r[\s\S]+SET expires_at = public\.ai_usage_reservation_effective_expiry\([\s\S]+r\.expires_at,[\s\S]+r\.provider_started_at[\s\S]+\)/,
  'rollout reservations must persist the same effective settlement lease used by commit/cleanup',
);
assert.match(
  rolloutBackfillMigration,
  /WHERE r\.status = 'reserved'[\s\S]+r\.provider_started_at IS NOT NULL[\s\S]+r\.expires_at < public\.ai_usage_reservation_effective_expiry/,
  'backfill must be narrowly scoped to provider-started reserved rows whose durable expiry is short',
);
assert.match(
  rolloutBackfillMigration,
  /updated_at = clock_timestamp\(\)/,
  'lease normalization should leave an observable mutation timestamp',
);

// A signed ticket must identify exactly one accepted provider attempt.
assert.match(
  sameTicketGuardMigration,
  /v_incoming_ticket_id := NULLIF\(TRIM\(COALESCE\(p_ticket_id, ''\)\), ''\)/,
  'provider ticket comparison must normalize the incoming ticket',
);
const sameTicketGuardIndex = sameTicketGuardMigration.indexOf('USAGE_PROVIDER_TICKET_ALREADY_ACCEPTED');
const inProgressGuardIndex = sameTicketGuardMigration.indexOf('USAGE_REQUEST_IN_PROGRESS');
const attemptUpdateIndex = sameTicketGuardMigration.indexOf('v_attempt_started_at := now()');
assert.ok(sameTicketGuardIndex >= 0, 'same-ticket replays must have a stable rejection code');
assert.ok(
  sameTicketGuardIndex < inProgressGuardIndex && inProgressGuardIndex < attemptUpdateIndex,
  'same-ticket rejection must happen before takeover timing and attempt mutation',
);
assert.match(
  sameTicketGuardMigration,
  /v_row\.last_attempt_at IS NOT NULL[\s\S]+v_incoming_ticket_id IS NOT NULL[\s\S]+v_row\.ticket_id IS NOT NULL[\s\S]+v_incoming_ticket_id = v_row\.ticket_id[\s\S]+USAGE_PROVIDER_TICKET_ALREADY_ACCEPTED/,
  'only a ticket already bound to an accepted attempt must be rejected',
);
assert.match(
  sameTicketGuardMigration,
  /ticket_id = COALESCE\(v_incoming_ticket_id, ticket_id\)/,
  'a genuinely new accepted takeover ticket must remain the active settlement identity',
);

// begin_ai_usage_reservation can block on accounting/reservation locks. Freshness
// must therefore use a wall-clock instant captured only after those locks are held.
const beginWallClockLockDaily = beginWallClockMigration.indexOf('FROM public.usage_counters');
const beginWallClockLockTotal = beginWallClockMigration.indexOf('FROM public.usage_totals');
const beginWallClockLockReservation = beginWallClockMigration.indexOf('FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE;');
const beginWallClockCapture = beginWallClockMigration.indexOf('v_wall_clock_now := clock_timestamp();');
assert.ok(beginWallClockLockDaily >= 0 && beginWallClockLockTotal > beginWallClockLockDaily);
assert.ok(beginWallClockLockReservation > beginWallClockLockTotal);
assert.ok(
  beginWallClockCapture > beginWallClockLockReservation,
  'wall-clock freshness must be captured after daily -> lifetime -> reservation serialization',
);
assert.match(
  beginWallClockMigration,
  /IF v_row\.status = 'reserved' AND v_effective_expiry <= v_wall_clock_now THEN/,
  'provider-start lease expiry must use serialized wall-clock time',
);
assert.match(
  beginWallClockMigration,
  /v_row\.last_attempt_at > v_wall_clock_now - interval '2 minutes'/,
  'provider takeover cooldown must use serialized wall-clock time',
);
assert.match(
  beginWallClockMigration,
  /v_attempt_started_at := v_wall_clock_now/,
  'accepted-attempt timestamps must share the same serialized freshness instant',
);
const beginWallClockFunctionStart = beginWallClockMigration.indexOf('CREATE OR REPLACE FUNCTION public.begin_ai_usage_reservation');
const beginWallClockFunctionEnd = beginWallClockMigration.indexOf('REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation');
const beginWallClockFunction = beginWallClockMigration.slice(beginWallClockFunctionStart, beginWallClockFunctionEnd);
assert.doesNotMatch(
  beginWallClockFunction,
  /\bnow\(\)/,
  'begin provider freshness must not depend on transaction-start time',
);

assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(leaseRefreshMigration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(sameTicketGuardMigration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(beginWallClockMigration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.assert_no_active_ai_usage_reservation\(UUID, TEXT\) FROM PUBLIC, anon, authenticated, service_role/);
assert.match(leaseRefreshMigration, /REVOKE ALL ON FUNCTION public\.begin_ai_usage_reservation\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
assert.match(sameTicketGuardMigration, /REVOKE ALL ON FUNCTION public\.begin_ai_usage_reservation\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
assert.match(beginWallClockMigration, /REVOKE ALL ON FUNCTION public\.begin_ai_usage_reservation\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(leaseRefreshMigration, /\bTRUNCATE\b/i);
assert.doesNotMatch(sameTicketGuardMigration, /\bTRUNCATE\b/i);
assert.doesNotMatch(rolloutBackfillMigration, /\bTRUNCATE\b/i);
assert.doesNotMatch(beginWallClockMigration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i);
assert.doesNotMatch(leaseRefreshMigration, /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i);
assert.doesNotMatch(sameTicketGuardMigration, /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i);
assert.doesNotMatch(rolloutBackfillMigration, /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i);
assert.doesNotMatch(beginWallClockMigration, /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i);

console.log('AI usage provider-started expiry regressions passed');
