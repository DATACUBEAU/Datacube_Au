import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failed = 0;

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

const sql = readFileSync(
  'supabase/migrations/20260830084500_ai_usage_commit_reservation_snapshot_lock.sql',
  'utf8',
);

run('commit acquires the same counter locks before mutating the reservation', () => {
  const daily = sql.indexOf('FROM public.usage_counters');
  const total = sql.indexOf('FROM public.usage_totals');
  const reservationLock = sql.indexOf('FROM public.ai_usage_reservations\n  WHERE id = p_reservation_id\n  FOR UPDATE');

  assert.ok(daily >= 0, 'daily counter lock must exist');
  assert.ok(total > daily, 'lifetime total lock must follow daily counter lock');
  assert.ok(reservationLock > total, 'reservation lock must follow counter locks');
  assert.match(sql, /FROM public\.usage_counters[\s\S]+FOR UPDATE/i);
  assert.match(sql, /FROM public\.usage_totals[\s\S]+FOR UPDATE/i);
});

run('the unlocked probe is not trusted for the final commit decision', () => {
  assert.match(sql, /v_probe public\.ai_usage_reservations%ROWTYPE/i);
  assert.match(sql, /SELECT \*[\s\S]+INTO v_row[\s\S]+FOR UPDATE/i);
  assert.match(sql, /v_row\.feature_key <> p_feature_key/i);
  assert.match(sql, /v_row\.route <> p_route/i);
  assert.match(sql, /v_row\.idempotency_key <> p_idempotency_key/i);
});

run('commit keeps admission-window attribution and idempotency semantics', () => {
  assert.match(sql, /occurred_at[\s\S]+v_row\.created_at/i);
  assert.match(sql, /IF v_row\.status = 'committed'[\s\S]+?'deduped', TRUE/i);
  assert.match(sql, /ON CONFLICT \(user_id, event_key\) DO NOTHING/i);
});

run('commit remains service-role only and migration is non-destructive', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.commit_ai_usage[\s\S]+FROM anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.commit_ai_usage[\s\S]+TO service_role/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});

if (failed > 0) process.exit(1);
