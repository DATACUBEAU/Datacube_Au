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
  'supabase/migrations/20260830094500_ai_usage_event_namespace_guard.sql',
  'utf8',
);

run('authenticated callers cannot create reserved AI reservation event keys', () => {
  assert.match(sql, /NEW\.event_key LIKE 'ai-reservation:%'/i);
  assert.match(sql, /auth\.role\(\)[\s\S]+<> 'service_role'/i);
  assert.match(sql, /RAISE EXCEPTION 'reserved usage event namespace'/i);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF event_key[\s\S]+ON public\.au_usage_events/i);
});

run('commit validates any conflicting deterministic event before deduping', () => {
  assert.match(sql, /assert_ai_reservation_usage_event/i);
  assert.match(sql, /v_event\.source IS DISTINCT FROM 'vps-ai-gateway'/i);
  assert.match(sql, /v_event\.metric_increments IS DISTINCT FROM p_metric_increments/i);
  assert.match(sql, /context ->> 'reservation_id'/i);
  assert.match(sql, /v_event\.occurred_at IS DISTINCT FROM p_occurred_at/i);
  assert.match(sql, /ON CONFLICT \(user_id, event_key\) DO NOTHING/i);
  assert.match(sql, /IF v_event_id IS NULL[\s\S]+assert_ai_reservation_usage_event/i);
});

run('already committed reservations require a valid durable event', () => {
  assert.match(sql, /IF v_row\.status = 'committed'[\s\S]+committed reservation is missing its usage event/i);
  assert.match(sql, /IF v_row\.status = 'committed'[\s\S]+assert_ai_reservation_usage_event/i);
});

run('guard helpers are not exposed and commit remains service-role only', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guard_ai_usage_event_namespace\(\)[\s\S]+FROM anon, authenticated, service_role/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.assert_ai_reservation_usage_event[\s\S]+FROM anon, authenticated, service_role/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.commit_ai_usage[\s\S]+FROM anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.commit_ai_usage[\s\S]+TO service_role/i);
});

run('migration is non-destructive to durable usage history', () => {
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});

if (failed > 0) process.exit(1);
