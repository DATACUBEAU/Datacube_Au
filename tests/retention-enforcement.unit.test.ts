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
    assert.match(route, /dryRunParam/);
    assert.match(route, /documentsQueuedForDeletion/);
    assert.doesNotMatch(route, /fileName/);
    assert.doesNotMatch(route, /filePath/);
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
    assert.match(retention, /QDRANT_COLLECTION/);
    assert.match(retention, /key: 'document_id'/);
    assert.match(retention, /key, match: \{ value: ownerId \}/);
    assert.match(retention, /\.eq\('id', candidate\.documentId\)[\s\S]+\.or\(`owner_id\.eq\.\$\{candidate\.ownerId\},user_id\.eq\.\$\{candidate\.ownerId\}`\)/);
  });

  await run('cleanup removes source, generated artifacts, and vector references together', () => {
    const retention = readRepoFile('src', 'lib', 'server', 'retention.ts');
    assert.match(retention, /deleteStorageObject\(supabase, candidate\.row\)/);
    assert.match(retention, /cleanupDocumentArtifacts\(supabase, candidate\.documentId\)/);
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

  await run('upload initiation stores a plan-based expiry before issuing the signed upload response', () => {
    const upload = readRepoFile('src', 'app', 'api', 'au', 'document-upload', 'route.ts');
    const expiryIndex = upload.indexOf('const uploadExpiresAt');
    const insertIndex = upload.indexOf("supabase.from('au_documents').upsert");
    assert.ok(expiryIndex > 0, 'missing upload expiry calculation');
    assert.ok(insertIndex > expiryIndex, 'expiry must be calculated before document upsert');
    assert.match(upload, /computeUploadExpiryFromPlan/);
    assert.match(upload, /insertPayload\.expires_at = uploadExpiresAt/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
