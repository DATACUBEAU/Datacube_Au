import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830134500_ai_usage_terminal_lock_order.sql',
  'utf8',
);

function functionBody(name: string, nextName?: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} must be defined`);
  const end = nextName
    ? migration.indexOf(`CREATE OR REPLACE FUNCTION public.${nextName}`, start + 1)
    : migration.indexOf('REVOKE ALL ON FUNCTION', start + 1);
  assert.ok(end > start, `${name} body boundary must be found`);
  return migration.slice(start, end);
}

for (const [name, nextName] of [
  ['begin_ai_usage_reservation', 'release_ai_usage'],
  ['release_ai_usage', 'expire_ai_usage_reservations'],
] as const) {
  const body = functionBody(name, nextName);
  const dailyLock = body.indexOf('FROM public.usage_counters');
  const totalLock = body.indexOf('FROM public.usage_totals');
  const reservationLock = body.indexOf('FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE');
  assert.ok(dailyLock >= 0, `${name} must lock the daily counter`);
  assert.ok(totalLock > dailyLock, `${name} must lock lifetime usage after daily usage`);
  assert.ok(reservationLock > totalLock, `${name} must lock the reservation after both counter rows`);
  assert.match(body, /SELECT \* INTO v_probe[\s\S]+IF v_probe\.user_id <> p_user_id/);
  assert.match(body, /FOR UPDATE;[\s\S]+v_row\.user_id <> p_user_id[\s\S]+v_row\.feature_key <> p_feature_key[\s\S]+v_row\.route <> p_route[\s\S]+v_row\.idempotency_key <> p_idempotency_key/);
}

const expiry = functionBody('expire_ai_usage_reservations');
const candidateRead = expiry.indexOf('SELECT COALESCE(array_agg(candidate.id');
const dailyBatchLocks = expiry.indexOf('FROM public.usage_counters');
const totalBatchLocks = expiry.indexOf('FROM public.usage_totals');
const reservationBatchLock = expiry.indexOf('FROM public.ai_usage_reservations\n    WHERE id = v_id\n    FOR UPDATE');
assert.ok(candidateRead >= 0, 'expiry must discover bounded candidates without row locking');
assert.ok(dailyBatchLocks > candidateRead, 'expiry must acquire daily counter locks after candidate discovery');
assert.ok(totalBatchLocks > dailyBatchLocks, 'expiry must acquire lifetime locks after daily locks');
assert.ok(reservationBatchLock > totalBatchLocks, 'expiry must lock reservations only after all accounting locks');
assert.match(expiry, /ORDER BY user_id, usage_day, expires_at, id/);
assert.match(expiry, /v_row\.status <> 'reserved' OR v_row\.expires_at > now\(\)/);
assert.doesNotMatch(expiry.slice(0, reservationBatchLock), /FOR UPDATE SKIP LOCKED/i);

assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.begin_ai_usage_reservation[\s\S]+FROM anon, authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.release_ai_usage[\s\S]+FROM anon, authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.expire_ai_usage_reservations[\s\S]+FROM anon, authenticated/);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i);

console.log('AI usage terminal lock-order regressions passed');
