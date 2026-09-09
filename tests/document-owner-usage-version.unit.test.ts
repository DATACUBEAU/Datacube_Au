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
  const migration = readFileSync(
    'supabase/migrations/20260828095000_document_owner_usage_mutation_guard.sql',
    'utf8',
  );
  const documentUsageQuery = readFileSync('src/lib/server/document-usage-query.ts', 'utf8');

  await run('canonical document usage can be owned through owner_id or user_id', () => {
    assert.match(documentUsageQuery, /owner_id\.eq\.\$\{userId\},user_id\.eq\.\$\{userId\}/);
    assert.match(documentUsageQuery, /\.or\(ownerOrUserFilter\)/);
  });

  await run('document usage mutations version every affected owner exactly once', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bump_document_usage_mutation_version/);
    assert.match(migration, /v_old_user_id := OLD\.user_id/);
    assert.match(migration, /v_old_owner_id := OLD\.owner_id/);
    assert.match(migration, /v_new_user_id := NEW\.user_id/);
    assert.match(migration, /v_new_owner_id := NEW\.owner_id/);
    assert.match(migration, /SELECT DISTINCT candidate/);
    assert.match(migration, /v_old_user_id,[\s\S]*v_old_owner_id,[\s\S]*v_new_user_id,[\s\S]*v_new_owner_id/);
    assert.match(migration, /version = public\.au_usage_mutation_versions\.version \+ 1/);
  });

  await run('document trigger upgrade is backward-safe for schemas without owner_id', () => {
    assert.match(migration, /to_regclass\('public\.au_documents'\)/);
    assert.match(migration, /column_name = 'user_id'/);
    assert.match(migration, /column_name = 'owner_id'/);
    assert.match(migration, /DROP TRIGGER IF EXISTS au_documents_bump_usage_mutation_version/);
    assert.match(migration, /EXECUTE FUNCTION public\.bump_document_usage_mutation_version\(\)/);
  });

  await run('document version hardening does not rewrite usage or adjustment history', () => {
    assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.au_usage_(?:events|admin_adjustments)/i);
    assert.doesNotMatch(migration, /UPDATE\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(migration, /TRUNCATE/i);
  });

  if (failed > 0) process.exit(1);
}

void main();
