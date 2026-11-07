import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831054500_ai_usage_commit_wall_clock_expiry.sql',
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.commit_ai_usage/);
assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);

const dailyLock = migration.indexOf('FROM public.usage_counters');
const totalLock = migration.indexOf('FROM public.usage_totals');
const reservationLock = migration.indexOf(
  'FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE;',
  totalLock,
);
const wallClock = migration.indexOf('v_settlement_now := clock_timestamp();');
assert.ok(
  dailyLock >= 0 && totalLock > dailyLock && reservationLock > totalLock,
  'late-commit hardening must preserve daily -> lifetime -> reservation lock ordering',
);
assert.ok(
  wallClock > reservationLock,
  'settlement wall-clock time must be captured only after accounting and reservation serialization',
);

const attemptMismatch = migration.indexOf("'code', 'USAGE_RESERVATION_ATTEMPT_MISMATCH'");
const committedReplay = migration.indexOf("IF v_row.status = 'committed' THEN");
const effectiveExpiry = migration.indexOf('public.ai_usage_reservation_effective_expiry(');
const expiredCode = migration.indexOf("'code', 'USAGE_RESERVATION_EXPIRED'");
const activeTransition = migration.indexOf("SET status = 'committed'");

assert.ok(
  attemptMismatch >= 0 && committedReplay > attemptMismatch,
  'attempt ownership must still be validated before committed replay handling',
);
assert.ok(
  effectiveExpiry > committedReplay && wallClock > effectiveExpiry && expiredCode > wallClock && activeTransition > expiredCode,
  'lease expiry must use serialized wall-clock time after safe committed replays but before reserved -> committed',
);
assert.match(
  migration,
  /IF v_row\.status = 'reserved' THEN[\s\S]+v_effective_expiry := public\.ai_usage_reservation_effective_expiry\([\s\S]+v_row\.expires_at,[\s\S]+v_row\.provider_started_at[\s\S]+v_settlement_now := clock_timestamp\(\);[\s\S]+IF v_effective_expiry <= v_settlement_now THEN/,
  'only still-provisional reservations should require an unexpired settlement lease at wall-clock execution time',
);
assert.doesNotMatch(
  migration,
  /IF v_effective_expiry <= now\(\) THEN/,
  'transaction-stable now() must not decide settlement lease validity',
);
assert.match(
  migration,
  /committed_at = v_settlement_now,[\s\S]+updated_at = v_settlement_now/,
  'commit audit timestamps should reflect the same serialized settlement instant',
);
assert.doesNotMatch(
  migration,
  /USAGE_RESERVATION_EXPIRED[\s\S]+SET status = 'expired'/,
  'commit should reject late settlement without duplicating cleanup counter mutations',
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.commit_ai_usage\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/,
);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i,
);

console.log('AI usage commit lease-expiry regressions passed');
