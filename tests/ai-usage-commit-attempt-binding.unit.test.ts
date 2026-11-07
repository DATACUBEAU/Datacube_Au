import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830174500_ai_usage_commit_attempt_binding.sql',
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.commit_ai_usage/);
assert.match(migration, /v_ticket_id TEXT := NULLIF\(TRIM\(COALESCE\(p_ticket_id, ''\)\), ''\)/);

const dailyLock = migration.indexOf('FROM public.usage_counters');
const totalLock = migration.indexOf('FROM public.usage_totals');
const reservationLock = migration.indexOf('FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE;', totalLock);
assert.ok(dailyLock >= 0 && totalLock > dailyLock && reservationLock > totalLock,
  'commit must retain daily -> lifetime -> reservation lock ordering');

const mismatch = migration.indexOf("'code', 'USAGE_RESERVATION_ATTEMPT_MISMATCH'");
const committedBranch = migration.indexOf("IF v_row.status = 'committed' THEN");
const activeTransition = migration.indexOf("SET status = 'committed'");
assert.ok(mismatch >= 0 && committedBranch > mismatch && activeTransition > mismatch,
  'attempt identity must be validated before both deduped and active commit paths');

assert.match(
  migration,
  /v_row\.ticket_id IS NOT NULL[\s\S]+v_ticket_id IS NULL OR v_ticket_id IS DISTINCT FROM v_row\.ticket_id/,
  'a bound reservation must reject a missing or stale provider-attempt ticket',
);
assert.doesNotMatch(
  migration,
  /ticket_id = COALESCE\(/,
  'commit must not overwrite the active attempt ticket with the terminal caller',
);
assert.match(migration, /v_ticket_id, NULL, v_row\.committed_units/,
  'usage event request identity should use the validated active attempt ticket');
assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.commit_ai_usage\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/,
);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i,
);

console.log('AI usage commit attempt-binding regressions passed');
