import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831194500_ai_usage_first_start_stale_release.sql',
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.begin_ai_usage_reservation/);

const dailyLock = migration.indexOf('FROM public.usage_counters');
const totalLock = migration.indexOf('FROM public.usage_totals');
const reservationLock = migration.indexOf("FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE;");
const wallClock = migration.indexOf('v_wall_clock_now := clock_timestamp();');
const staleCode = migration.indexOf('USAGE_PROVIDER_START_WINDOW_STALE');
const attemptMutation = migration.indexOf('v_attempt_started_at := v_wall_clock_now;');

assert.ok(dailyLock >= 0 && totalLock > dailyLock);
assert.ok(reservationLock > totalLock);
assert.ok(wallClock > reservationLock, 'provider-start freshness must use serialized wall-clock time');
assert.ok(staleCode > wallClock, 'stale-window rejection must use the serialized wall clock');
assert.ok(attemptMutation > staleCode, 'stale provider starts must be rejected before attempt mutation');

assert.match(
  migration,
  /FOR v_limit_check IN[\s\S]+jsonb_array_elements\(COALESCE\(v_row\.limit_checks, '\[\]'::jsonb\)\)/,
  'every provider start should inspect the reservation admission windows',
);
assert.match(
  migration,
  /v_limit_scope NOT IN \('canonical_plan', 'tier_quota'\)[\s\S]+CONTINUE/,
  'provider-start validation must cover plan and tier quota windows',
);
assert.match(
  migration,
  /IF v_row\.last_attempt_at IS NULL THEN[\s\S]+public\.ai_usage_negate_units\(v_row\.reserved_units\)[\s\S]+status = 'expired'[\s\S]+provider_start_window_stale/,
  'a stale first start must synchronously release never-started reserved units',
);
assert.match(
  migration,
  /IF v_row\.last_attempt_at IS NULL THEN[\s\S]+END IF;[\s\S]+RETURN jsonb_build_object\([\s\S]+'code', 'USAGE_PROVIDER_START_WINDOW_STALE'/,
  'later stale takeovers must remain non-terminal and return the stable error',
);
assert.match(
  migration,
  /v_row\.last_attempt_at IS NOT NULL[\s\S]+v_incoming_ticket_id = v_row\.ticket_id[\s\S]+USAGE_PROVIDER_TICKET_ALREADY_ACCEPTED/,
  'same-ticket replay protection must remain intact',
);
assert.match(
  migration,
  /v_row\.last_attempt_at IS NOT NULL[\s\S]+v_row\.last_attempt_at > v_wall_clock_now - interval '2 minutes'[\s\S]+USAGE_REQUEST_IN_PROGRESS/,
  'the takeover cooldown must remain intact',
);
assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.begin_ai_usage_reservation\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/,
);

console.log('AI usage provider-start window regressions passed');
