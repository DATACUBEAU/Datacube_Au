import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failed = 0;

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

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
  await run('cron retention route is server-secret protected and supports aggregate dry-run', () => {
    const route = readRepoFile('src', 'app', 'api', 'cron', 'retention', 'route.ts');
    assert.match(route, /RETENTION_CRON_SECRET/);
    assert.match(route, /CRON_SECRET/);
    assert.match(route, /x-cron-secret/);
    assert.match(route, /authorization/);
    assert.match(route, /timingSafeEqual/);
    assert.match(route, /Cache-Control/);
    assert.match(route, /no-store/);
    assert.match(route, /dryRunParam/);
    assert.match(route, /documentsQueuedForDeletion/);
    assert.doesNotMatch(route, /fileName/);
    assert.doesNotMatch(route, /filePath/);
  });

  await run('retention production runtime migration creates required objects without deleting data', () => {
    const migration = readRepoFile(
      'supabase',
      'migrations',
      '20260730120000_retention_production_runtime.sql',
    );
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.au_retention_runs/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.au_retention_actions/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.au_runtime_leases/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.au_deletion_log/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.au_user_activity/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.try_claim_retention_lease/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.release_retention_lease/);
    assert.match(migration, /retention_granted_at/);
    assert.match(migration, /retention_expires_at/);
    assert.match(migration, /retention_tier/);
    assert.match(migration, /retention_days/);
    assert.match(migration, /idx_au_documents_retention_deadline/);
    assert.match(migration, /idx_au_user_profiles_last_activity_at/);
    assert.match(migration, /idx_au_user_activity_last_active_at/);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.au_retention_actions FROM anon, authenticated/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.au_user_activity FROM anon, authenticated/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.try_claim_retention_lease/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.log_document_deletion\(\) FROM PUBLIC, anon, authenticated/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.inherit_attachment_expiry_from_parent\(\) FROM PUBLIC, anon, authenticated/);
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+public\.(?!au_runtime_leases\b)/i);
    assert.doesNotMatch(migration, /\bUPDATE\s+public\.au_documents\b/i);
  });

  await run('scheduled retention deletes documents only and does not schedule account deletion', () => {
    const retention = readRepoFile('src', 'lib', 'server', 'retention.ts');
    const runStart = retention.indexOf('export async function runRetentionCleanup');
    const deleteUserStart = retention.indexOf('export async function deleteUserAccountWithRetention');
    const runBody = retention.slice(runStart, deleteUserStart);
    assert.match(runBody, /processDocumentCandidate/);
    assert.doesNotMatch(runBody, /processUserDeletion\(/);
    assert.match(runBody, /processedUsers = 0/);
    assert.match(retention, /scheduledFullDeletionUsers:\s*0/);
  });

  await run('document cleanup is owner-bound across Postgres and Qdrant', () => {
    const retention = readRepoFile('src', 'lib', 'server', 'retention.ts');
    assert.match(retention, /deleteVectorsDirect\(candidate\.documentId, candidate\.ownerId\)/);
    assert.match(retention, /cleanupDocumentArtifacts\(supabase, candidate\.documentId, candidate\.ownerId\)/);
    assert.match(retention, /QDRANT_COLLECTION/);
    assert.match(retention, /key: 'document_id'/);
    assert.match(retention, /key, match: \{ value: ownerId \}/);
    assert.match(retention, /owner_filter_required/);
    assert.match(retention, /ownerColumns: \['owner_id', 'user_id'\]/);
    assert.match(retention, /ownerColumns: \['user_id', 'owner_id'\]/);
    assert.match(retention, /\.eq\('id', candidate\.documentId\)[\s\S]+\.or\(`owner_id\.eq\.\$\{candidate\.ownerId\},user_id\.eq\.\$\{candidate\.ownerId\}`\)/);
  });

  await run('cleanup removes source, generated artifacts, and vector references together', () => {
    const retention = readRepoFile('src', 'lib', 'server', 'retention.ts');
    assert.match(retention, /deleteStorageObject\(supabase, candidate\.row\)/);
    assert.match(retention, /cleanupDocumentArtifacts\(supabase, candidate\.documentId, candidate\.ownerId\)/);
    assert.match(retention, /deleteVectorsDirect\(candidate\.documentId, candidate\.ownerId\)/);
    assert.match(retention, /markDeletionLogsProcessed\(supabase, candidate\.documentId\)/);
    assert.match(retention, /isStorageMissingError/);
  });

  await run('retention action logging is best-effort and cleanup failures leave retry state', () => {
    const retention = readRepoFile('src', 'lib', 'server', 'retention.ts');
    assert.match(retention, /action-log-skipped/);
    assert.match(retention, /retention_actions_table_missing/);
    assert.match(retention, /artifact_cleanup_failed/);
    assert.match(retention, /vector_delete_failed/);
    assert.match(retention, /lastError: artifactError \|\| 'artifact_cleanup_failed'/);
    assert.match(retention, /lastError: message/);
    assert.match(retention, /lastError: deleteError\.message/);
  });

  await run('missing retention lease RPC falls back to a bounded local lease instead of crashing', () => {
    const retention = readRepoFile('src', 'lib', 'server', 'retention.ts');
    assert.match(retention, /function isMissingFunctionError/);
    assert.match(retention, /code === '42883'/);
    assert.match(retention, /code === 'PGRST202'/);
    assert.match(retention, /RETENTION_LOCAL_LEASE_TTL_MS = 15 \* 60 \* 1000/);
    assert.match(retention, /return claimLocalRetentionLease\(workerId\)/);
    assert.match(retention, /releaseLocalRetentionLease\(workerId\)/);
  });

  await run('authenticated activity is updated through a server-only route', () => {
    const client = readRepoFile('src', 'lib', 'supabase-client', 'client.ts');
    const route = readRepoFile('src', 'app', 'api', 'auth', 'activity', 'route.ts');
    assert.match(client, /safeFetch\('\/api\/auth\/activity'/);
    assert.doesNotMatch(client, /\/rest\/v1\/rpc\/record_user_activity/);
    assert.doesNotMatch(client, /\/rest\/v1\/au_user_activity\?/);
    assert.match(route, /requireUserFromRequest\(req\)/);
    assert.match(route, /createSupabaseAdminClient\(\)/);
    assert.doesNotMatch(route, /\.rpc\('record_user_activity'/);
    assert.match(route, /\.from\('au_user_activity'\)/);
    assert.match(route, /\.from\('au_user_profiles'\)/);
    assert.match(route, /user_id:\s*auth\.userId/);
    assert.doesNotMatch(route, /user_id:\s*body/);
    assert.match(route, /ACTIVITY_RPC_SIGNATURE_MISMATCH/);
    assert.match(route, /activity_update_degraded/);
    assert.match(route, /status:\s*202/);
    assert.match(route, /requestId/);
    assert.match(route, /Cache-Control/);
    assert.match(route, /no-store/);
  });

  await run('upload initiation stores a plan-based expiry before issuing the signed upload response', () => {
    const upload = readRepoFile('src', 'app', 'api', 'au', 'document-upload', 'route.ts');
    const expiryIndex = upload.indexOf('const uploadExpiresAt');
    const insertIndex = upload.indexOf("supabase.from('au_documents').upsert");
    assert.ok(expiryIndex > 0, 'missing upload expiry calculation');
    assert.ok(insertIndex > expiryIndex, 'expiry must be calculated before document upsert');
    assert.match(upload, /computeUploadExpiryFromPlan/);
    assert.match(upload, /insertPayload\.expires_at = uploadExpiresAt/);
    assert.match(upload, /retention_granted_at/);
    assert.match(upload, /retention_expires_at/);
    assert.match(upload, /retention_tier/);
    assert.match(upload, /retention_days/);
    assert.match(upload, /RETENTION_POLICY_VERSION/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
