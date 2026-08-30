import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830184500_ai_usage_ticket_reissue_acceptance.sql',
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reserve_ai_usage/);
assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);

const dailyLock = migration.indexOf('FROM public.usage_counters');
const totalLock = migration.indexOf('FROM public.usage_totals');
const replayRead = migration.indexOf('FROM public.ai_usage_reservations', totalLock);
assert.ok(
  dailyLock >= 0 && totalLock > dailyLock && replayRead > totalLock,
  'reservation replay inspection must follow daily -> lifetime accounting locks',
);

const preserveTicket = migration.indexOf('v_forward_ticket_id := NULL;');
const preserveExpiry = migration.indexOf('v_forward_expires_at := v_existing.expires_at;');
const innerCall = migration.indexOf('RETURN public.reserve_ai_usage_window_unchecked');
assert.ok(
  preserveTicket >= 0 && preserveExpiry > preserveTicket && innerCall > preserveExpiry,
  'existing reservation replay must preserve current attempt identity and lease before delegating',
);

assert.match(
  migration,
  /v_forward_ticket_id,\s*v_forward_expires_at\s*\n\s*\);/,
  'the unchecked reservation function must receive replay-safe forwarded ticket and expiry values',
);
assert.doesNotMatch(
  migration,
  /UPDATE\s+public\.ai_usage_reservations[\s\S]{0,300}ticket_id\s*=/i,
  'the public reserve boundary must not bind a replacement provider ticket directly',
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

console.log('AI usage ticket reissue acceptance regressions passed');
