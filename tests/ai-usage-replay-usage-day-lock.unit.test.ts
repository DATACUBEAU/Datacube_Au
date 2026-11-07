import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830194500_ai_usage_replay_usage_day_lock.sql',
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reserve_ai_usage/);
assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);

const probe = migration.indexOf('SELECT * INTO v_probe');
const useOriginalDay = migration.indexOf('v_usage_day := v_probe.usage_day;');
const dailyLock = migration.indexOf('FROM public.usage_counters', useOriginalDay);
const totalLock = migration.indexOf('FROM public.usage_totals', dailyLock);
const replayRead = migration.indexOf('SELECT * INTO v_existing', totalLock);
assert.ok(
  probe >= 0 &&
    useOriginalDay > probe &&
    dailyLock > useOriginalDay &&
    totalLock > dailyLock &&
    replayRead > totalLock,
  'replays must derive the original usage_day before daily -> lifetime locks and then re-read the reservation',
);

const replayBranch = migration.indexOf('IF FOUND THEN', replayRead);
const preserveTicket = migration.indexOf('v_forward_ticket_id := NULL;', replayBranch);
const freshnessBranch = migration.indexOf('ELSE', replayBranch);
const staleWindow = migration.indexOf("'USAGE_WINDOW_STALE'", freshnessBranch);
assert.ok(
  replayBranch >= 0 && preserveTicket > replayBranch && freshnessBranch > preserveTicket && staleWindow > freshnessBranch,
  'window freshness must apply only to fresh admission, after matching replay handling',
);

assert.match(migration, /v_forward_expires_at := v_existing\.expires_at;/);
assert.match(
  migration,
  /RETURN public\.reserve_ai_usage_window_unchecked\([\s\S]*v_forward_ticket_id,[\s\S]*v_forward_expires_at/,
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.reserve_ai_usage\([\s\S]+FROM PUBLIC, anon, authenticated/,
);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i,
);

console.log('AI usage replay usage-day lock regressions passed');
