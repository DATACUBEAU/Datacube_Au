import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830164000_ai_usage_release_attempt_binding.sql',
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.release_ai_usage/);
assert.match(migration, /v_ticket_id TEXT := NULLIF\(TRIM\(COALESCE\(p_ticket_id, ''\)\), ''\)/);

const dailyLock = migration.indexOf('FROM public.usage_counters');
const totalLock = migration.indexOf('FROM public.usage_totals');
const reservationLock = migration.indexOf('FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE;', totalLock);
assert.ok(dailyLock >= 0 && totalLock > dailyLock && reservationLock > totalLock,
  'release must retain daily -> lifetime -> reservation lock ordering');

assert.match(
  migration,
  /v_row\.status = 'reserved'[\s\S]+v_row\.ticket_id IS NOT NULL[\s\S]+v_ticket_id IS NULL OR v_ticket_id IS DISTINCT FROM v_row\.ticket_id/,
  'an active reservation must reject a missing or stale provider-attempt ticket',
);
assert.match(migration, /'code', 'USAGE_RESERVATION_ATTEMPT_MISMATCH'/);

const mismatch = migration.indexOf("'code', 'USAGE_RESERVATION_ATTEMPT_MISMATCH'");
const decrement = migration.indexOf('public.ai_usage_negate_units(v_row.reserved_units)');
assert.ok(mismatch >= 0 && decrement > mismatch,
  'attempt identity must be validated before reserved units can be subtracted');

assert.doesNotMatch(
  migration,
  /ticket_id = COALESCE\(/,
  'release must not overwrite the active attempt ticket with a stale terminal caller',
);
assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.release_ai_usage\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/,
);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i,
);

console.log('AI usage release attempt-binding regressions passed');
