import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failed = 0;

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

async function main() {
  const sql = readFileSync('supabase/migrations/20260830064500_ai_reservation_window_freshness.sql', 'utf8');

  await run('finite canonical windows are validated transactionally before reservation', () => {
    assert.match(sql, /v_scope = 'canonical_plan'/i);
    assert.match(sql, /v_counter_scope IN \('today', 'window'\)/i);
    assert.match(sql, /v_now < v_window_start OR v_now >= v_window_end/i);
    assert.match(sql, /v_window_end <= v_window_start/i);
    assert.match(sql, /'code', 'USAGE_WINDOW_STALE'/i);
    assert.match(sql, /'retryable', TRUE/i);
  });

  await run('rolling deploy payloads without window metadata remain compatible', () => {
    assert.match(sql, /window_start[\s\S]+IS NOT NULL[\s\S]+window_end[\s\S]+IS NOT NULL/i);
    assert.match(sql, /reserve_ai_usage_window_unchecked\(/i);
  });

  await run('unchecked implementation is not exposed through PostgREST roles', () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.reserve_ai_usage_window_unchecked[\s\S]+FROM PUBLIC, anon, authenticated, service_role/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reserve_ai_usage[\s\S]+TO service_role/i);
    assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.reserve_ai_usage_window_unchecked[\s\S]+TO (?:anon|authenticated|service_role)/i);
  });

  await run('migration is non-destructive', () => {
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });

  if (failed > 0) process.exit(1);
}

main();
