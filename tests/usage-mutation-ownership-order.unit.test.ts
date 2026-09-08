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
    'supabase/migrations/20260908044500_usage_mutation_statement_order.sql',
    'utf8',
  );

  await run('ownership version bumps use one stable UUID order', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bump_usage_mutation_versions_ordered/);
    assert.match(migration, /SELECT DISTINCT candidate[\s\S]*ORDER BY candidate/);
    assert.match(migration, /EXISTS \(SELECT 1 FROM auth\.users WHERE id = candidate\)/);
    assert.match(migration, /version = public\.au_usage_mutation_versions\.version \+ 1/);
  });

  await run('generic ownership changes collect old and new users before bumping versions', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bump_usage_mutation_versions_update_statement/);
    assert.match(migration, /SELECT user_id FROM old_rows WHERE user_id IS NOT NULL[\s\S]*UNION[\s\S]*SELECT user_id FROM new_rows WHERE user_id IS NOT NULL/);
    assert.match(migration, /PERFORM public\.bump_usage_mutation_versions_ordered\(v_user_ids\)/);
  });

  await run('fallback tables use statement transition triggers instead of per-row ownership ordering', () => {
    for (const table of ['au_messages', 'au_model_usage', 'au_feature_outputs']) {
      assert.match(migration, new RegExp(`'${table}'`));
    }
    assert.match(migration, /DROP TRIGGER IF EXISTS %I ON public\.%I/);
    assert.match(migration, /REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT/);
    assert.match(migration, /REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT/);
    assert.match(migration, /REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT/);
  });

  await run('document ownership changes include user and owner IDs across the full statement', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bump_document_usage_mutation_versions_update_statement/);
    assert.match(migration, /SELECT user_id AS candidate FROM old_rows/);
    assert.match(migration, /SELECT owner_id AS candidate FROM old_rows/);
    assert.match(migration, /SELECT user_id AS candidate FROM new_rows/);
    assert.match(migration, /SELECT owner_id AS candidate FROM new_rows/);
    assert.match(migration, /EXECUTE FUNCTION public\.bump_document_usage_mutation_versions_update_statement\(\)/);
  });

  await run('older document schemas retain ordered user_id-only statement tracking', () => {
    assert.match(migration, /column_name = 'owner_id'/);
    assert.match(migration, /EXECUTE FUNCTION public\.bump_usage_mutation_versions_insert_statement\(\)/);
    assert.match(migration, /EXECUTE FUNCTION public\.bump_usage_mutation_versions_update_statement\(\)/);
    assert.match(migration, /EXECUTE FUNCTION public\.bump_usage_mutation_versions_delete_statement\(\)/);
  });

  await run('statement trigger helpers are not exposed as PostgREST mutation surfaces', () => {
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.bump_usage_mutation_versions_ordered\(UUID\[\]\) FROM PUBLIC, anon, authenticated/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.bump_usage_mutation_versions_update_statement\(\) FROM PUBLIC, anon, authenticated/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.bump_document_usage_mutation_versions_update_statement\(\) FROM PUBLIC, anon, authenticated/);
  });

  await run('lock-order hardening does not rewrite durable usage or adjustment history', () => {
    assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.au_usage_(?:events|admin_adjustments|counters|totals)/i);
    assert.doesNotMatch(migration, /UPDATE\s+public\.au_usage_admin_adjustments/i);
    assert.doesNotMatch(migration, /TRUNCATE/i);
  });

  if (failed > 0) process.exit(1);
}

void main();
