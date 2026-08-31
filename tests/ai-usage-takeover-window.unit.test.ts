import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831094500_ai_usage_takeover_window_guard.sql',
  'utf8',
);

assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.begin_ai_usage_reservation/,
  'the final provider-start boundary must own takeover window validation',
);

const dailyLock = migration.indexOf('FROM public.usage_counters');
const totalLock = migration.indexOf('FROM public.usage_totals');
const reservationLock = migration.indexOf("FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE;");
const wallClock = migration.indexOf('v_wall_clock_now := clock_timestamp();');
const staleCode = migration.indexOf('USAGE_PROVIDER_TAKEOVER_WINDOW_STALE');
const attemptMutation = migration.indexOf('v_attempt_started_at := v_wall_clock_now;');

assert.ok(dailyLock >= 0 && totalLock > dailyLock);
assert.ok(reservationLock > totalLock);
assert.ok(wallClock > reservationLock, 'takeover freshness must use serialized wall-clock time');
assert.ok(staleCode > wallClock, 'stale-window rejection must use the serialized wall clock');
assert.ok(attemptMutation > staleCode, 'stale takeovers must be rejected before attempt/lease mutation');

assert.match(
  migration,
  /IF v_row\.last_attempt_at IS NOT NULL THEN[\s\S]+jsonb_array_elements\(COALESCE\(v_row\.limit_checks, '\[\]'::jsonb\)\)/,
  'only a later provider attempt should be subject to takeover-window revalidation',
);
assert.match(
  migration,
  /v_limit_scope NOT IN \('canonical_plan', 'tier_quota'\)[\s\S]+CONTINUE/,
  'takeover validation must cover both authoritative plan and tier quota windows',
);
assert.match(
  migration,
  /v_window_start IS NOT NULL[\s\S]+v_window_end IS NOT NULL[\s\S]+v_wall_clock_now < v_window_start OR v_wall_clock_now >= v_window_end/,
  'finite takeovers must remain inside their originally admitted quota window',
);
assert.match(
  migration,
  /'code', 'USAGE_PROVIDER_TAKEOVER_WINDOW_STALE'/,
  'stale takeovers need a stable operational error code',
);
assert.match(
  migration,
  /v_row\.last_attempt_at IS NOT NULL[\s\S]+v_incoming_ticket_id = v_row\.ticket_id[\s\S]+USAGE_PROVIDER_TICKET_ALREADY_ACCEPTED/,
  'same-ticket replay protection must remain intact before takeover processing',
);
assert.match(
  migration,
  /PERFORM public\.ai_usage_require_service_role\(\)/,
  'provider-start mutation must remain service-role-only',
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.begin_ai_usage_reservation\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/,
);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i,
);

console.log('AI usage takeover-window regressions passed');
