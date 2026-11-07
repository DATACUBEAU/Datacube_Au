import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260830024500_usage_event_mutation_version_guard.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

assert.match(sql, /public\.au_usage_events/i, 'migration must target the authoritative usage-event ledger');
assert.match(
  sql,
  /AFTER\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.au_usage_events/i,
  'all event-ledger mutations that can change a quota window must advance the mutation version',
);
assert.match(
  sql,
  /EXECUTE\s+FUNCTION\s+public\.bump_usage_mutation_version\s*\(\s*\)/i,
  'event commits must share the existing per-user usage mutation version boundary',
);
assert.match(
  sql,
  /column_name\s*=\s*'user_id'/i,
  'migration must fail safely if the usage ledger cannot be attributed to a user',
);
assert.doesNotMatch(
  sql,
  /CREATE\s+TABLE\s+.*usage.*version/i,
  'the fix must reuse the existing mutation-version source of truth rather than creating a parallel counter',
);

console.log('usage event mutation version guard regression passed');
