import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260830144500_ai_usage_provider_started_expiry.sql',
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

assert.match(migration, /PERFORM public\.ai_usage_require_service_role\(\)/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.assert_no_active_ai_usage_reservation\(UUID, TEXT\) FROM PUBLIC, anon, authenticated, service_role/);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(?:ai_usage_reservations|usage_counters|usage_totals|au_usage_events)/i);

console.log('AI usage provider-started expiry regressions passed');
