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
  'supabase/migrations/20260830055000_ai_usage_commit_admission_window.sql',
  'utf8',
);

run('committed AI usage stays in the reservation admission window', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.commit_ai_usage/i);
  assert.match(sql, /occurred_at[\s\S]+v_row\.created_at/i);
  assert.doesNotMatch(sql, /occurred_at[\s\S]{0,500}\bnow\(\)/i);
});

run('reservation keeps separate admission and commit timestamps for auditability', () => {
  assert.match(sql, /committed_at\s*=\s*now\(\)/i);
  assert.match(sql, /'admitted_at',\s*v_row\.created_at/i);
  assert.match(sql, /'committed_at',\s*v_row\.committed_at/i);
});

run('commit remains idempotent and service-role only', () => {
  assert.match(sql, /IF v_row\.status = 'committed'[\s\S]+?'deduped', TRUE/i);
  assert.match(sql, /ON CONFLICT \(user_id, event_key\) DO NOTHING/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.commit_ai_usage[\s\S]+FROM anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.commit_ai_usage[\s\S]+TO service_role/i);
});

run('migration is non-destructive', () => {
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});

if (failed > 0) process.exit(1);
