import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260903065000_track_worker_terminal_usage_events.sql',
);
const planAttributionMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260903094500_worker_usage_plan_attribution.sql',
);
const indexedChunkMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260903164000_meter_indexed_ingestion_chunks.sql',
);
const workerPath = path.join(process.cwd(), 'rag-worker/src/worker.ts');

const sql = fs.readFileSync(migrationPath, 'utf8');
const planSql = fs.readFileSync(planAttributionMigrationPath, 'utf8');
const indexedChunkSql = fs.readFileSync(indexedChunkMigrationPath, 'utf8');
const worker = fs.readFileSync(workerPath, 'utf8');

assert.match(
  sql,
  /v_event_key\s*:=\s*'worker_job:'\s*\|\|\s*NEW\.id::TEXT\s*\|\|\s*':'\s*\|\|\s*NEW\.status/i,
  'worker usage events must use deterministic job-id + terminal-outcome keys',
);
assert.match(
  sql,
  /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*event_key\s*\)\s+DO\s+NOTHING/i,
  'terminal usage-event writes must remain retry-safe under duplicate terminal updates',
);
assert.match(
  sql,
  /AFTER\s+UPDATE\s+OF\s+status\s+ON\s+public\.au_worker_jobs[\s\S]*OLD\.status\s+IS\s+DISTINCT\s+FROM\s+NEW\.status[\s\S]*NEW\.status\s+IN\s*\(\s*'completed'\s*,\s*'failed'\s*\)/i,
  'usage events must only be captured on real transitions into terminal states',
);
assert.match(
  sql,
  /COALESCE\(NEW\.owner_id,\s*NEW\.user_id\)/i,
  'terminal usage must remain attributable to the durable worker-job owner',
);
assert.match(
  sql,
  /jsonb_strip_nulls\s*\(\s*jsonb_build_object\([\s\S]*'job_id'\s*,\s*NEW\.id[\s\S]*'document_id'\s*,\s*NEW\.document_id[\s\S]*'outcome'\s*,\s*NEW\.status[\s\S]*'worker_id'[\s\S]*'correlation_id'/i,
  'terminal events must preserve job/document/outcome/worker/correlation provenance without document contents',
);
assert.match(
  sql,
  /'document_ingestion'\s*,\s*'worker_status_transition'/i,
  'worker processing must remain clearly identified as document-ingestion usage',
);
assert.match(
  sql,
  /'jobs_completed'\s*,\s*1/i,
  'completed jobs must map to the jobs_completed metric',
);
assert.match(
  sql,
  /'jobs_failed'\s*,\s*1/i,
  'failed jobs must map to the jobs_failed metric',
);
assert.doesNotMatch(
  sql,
  /increment_usage_counters/i,
  'the event trigger must not mutate legacy counters and accidentally double-increment worker snapshots',
);
assert.match(
  sql,
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.capture_worker_terminal_usage_event\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
  'the security-definer trigger function must not remain callable by browser roles',
);
assert.match(
  sql,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.capture_worker_terminal_usage_event\(\)\s+TO\s+service_role/i,
  'service-role execution must remain available for the trigger-owned processing path',
);

// Cost attribution must be tied to the server-side entitlement state at the
// moment the terminal event is written. Keep this descriptive: plan snapshots
// must not become a second enforcement source.
assert.match(
  planSql,
  /FROM\s+public\.au_user_entitlements\s+e[\s\S]*WHERE\s+e\.user_id\s*=\s*v_owner_id/i,
  'worker plan attribution must come from the authoritative entitlement row for the job owner',
);
assert.match(
  planSql,
  /admin_override_plan/i,
  'admin plan overrides must be reflected in the processing usage snapshot',
);
assert.match(
  planSql,
  /expires_at\s+IS\s+NOT\s+NULL\s+AND\s+e\.expires_at\s*<=\s*v_occurred_at[\s\S]*THEN\s+'free'/i,
  'expired paid entitlements must not be attributed as active paid plans',
);
assert.match(
  planSql,
  /'plan_snapshot'\s*,\s*v_plan[\s\S]*'entitlement_source_snapshot'\s*,\s*v_entitlement_source[\s\S]*'plan_expires_at_snapshot'\s*,\s*v_plan_expires_at/i,
  'terminal usage context must preserve plan, entitlement-source, and expiry snapshots',
);
assert.match(
  planSql,
  /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*event_key\s*\)\s+DO\s+NOTHING/i,
  'plan attribution must preserve the same retry-safe event identity',
);
assert.match(
  planSql,
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.capture_worker_terminal_usage_event\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
  'plan-attribution replacement must preserve browser-role restrictions',
);

// Successful ingestion already verifies that canonical chunk rows and Qdrant
// points agree before the job can reach completed. Meter that durable indexed
// output in the existing terminal event instead of introducing another counter.
assert.match(
  indexedChunkSql,
  /'indexed_chunks'\s*,\s*'Indexed document chunks'[\s\S]*'processing'[\s\S]*NULL[\s\S]*'monthly'/i,
  'indexed chunks must be registered as a processing metric with no plan limit',
);
assert.match(
  indexedChunkSql,
  /to_regclass\('public\.au_document_chunks'\)/i,
  'completed-job chunk metering must read the durable canonical chunk table',
);
assert.match(
  indexedChunkSql,
  /document_id\s*=\s*\$1[\s\S]*(owner_id\s*=\s*\$2|user_id\s*=\s*\$2)/i,
  'indexed chunk counting must remain scoped to the completed job document and owner when ownership columns exist',
);
assert.match(
  indexedChunkSql,
  /jsonb_build_object\('jobs_completed'\s*,\s*1\)[\s\S]*jsonb_build_object\('indexed_chunks'\s*,\s*v_indexed_chunk_count\)/i,
  'completed terminal events must carry the indexed chunk amount in the same authoritative usage event',
);
assert.match(
  indexedChunkSql,
  /'indexed_chunk_count'\s*,\s*CASE\s+WHEN\s+NEW\.status\s*=\s*'completed'\s+THEN\s+v_indexed_chunk_count/i,
  'indexed chunk provenance must remain visible in terminal usage context',
);
assert.match(
  indexedChunkSql,
  /v_event_key\s*:=\s*'worker_job:'\s*\|\|\s*NEW\.id::TEXT\s*\|\|\s*':'\s*\|\|\s*NEW\.status[\s\S]*ON\s+CONFLICT\s*\(\s*user_id\s*,\s*event_key\s*\)\s+DO\s+NOTHING/i,
  'indexed chunk metering must inherit the retry-safe worker terminal event identity',
);
assert.match(
  indexedChunkSql,
  /'plan_snapshot'\s*,\s*v_plan[\s\S]*'entitlement_source_snapshot'\s*,\s*v_entitlement_source/i,
  'indexed chunk usage must preserve server-side plan attribution',
);
assert.doesNotMatch(
  indexedChunkSql,
  /increment_usage_counters/i,
  'indexed chunk metering must not create a parallel mutable compatibility counter',
);

// Compatibility remains explicit until worker-side direct counter writes can be
// removed safely. This prevents accidental claims that the legacy projection is
// already gone while the worker still writes it.
assert.match(
  worker,
  /incrementUsageCounters[\s\S]*jobs_completed\s*:\s*1/i,
  'worker completion still maintains the compatibility snapshot during rollout',
);
assert.match(
  worker,
  /incrementUsageCounters[\s\S]*jobs_failed\s*:\s*1/i,
  'worker failure still maintains the compatibility snapshot during rollout',
);

// Failed-job compatibility accounting must never get ahead of durable terminal
// persistence. A failed au_worker_jobs update means the terminal usage-event
// trigger did not fire, so the legacy snapshot must also stay unchanged.
assert.match(
  worker,
  /private\s+async\s+markJobFailed\([\s\S]*\):\s*Promise<Error\s*\|\s*null>[\s\S]*return\s+error;/i,
  'markJobFailed must surface terminal persistence failure to its caller',
);
assert.match(
  worker,
  /const\s+failurePersistError\s*=\s*await\s+this\.markJobFailed\([\s\S]*await\s+this\.markDocumentFailed\([\s\S]*if\s*\(!failurePersistError\)\s*\{[\s\S]*jobs_failed\s*:\s*1/i,
  'legacy jobs_failed usage must only advance after the durable failed state persists',
);
assert.match(
  worker,
  /Skipping failed-job compatibility usage because terminal state did not persist/i,
  'failed terminal persistence should remain observable without creating phantom usage',
);

// Ingestion retention must consume the same authoritative entitlement boundary
// as the rest of the SaaS. Do not recreate plan/billing resolution inside the
// worker or silently assign a default lifetime when the authoritative RPC fails.
assert.match(
  worker,
  /if\s*\(!inheritedParentExpiryMs\)\s*\{[\s\S]*this\.supabase\.rpc\(\s*'get_effective_entitlements'\s*,\s*\{\s*p_user_id:\s*ownerId\s*\}/i,
  'non-inherited document retention must use the authoritative effective-entitlements RPC',
);
assert.match(
  worker,
  /rawRetentionDays\s*=\s*Number\([\s\S]*retention_days[\s\S]*Number\.isFinite\(rawRetentionDays\)[\s\S]*rawRetentionDays\s*<=\s*0[\s\S]*entitlement_resolution_invalid/i,
  'worker must reject invalid authoritative retention values instead of inventing a fallback',
);
assert.match(
  worker,
  /entitlementError[\s\S]*createRecoverableJobError\([\s\S]*entitlement_resolution_failed[\s\S]*entitlement_resolution_failed/i,
  'authoritative entitlement lookup failure must remain recoverable and observable',
);
assert.match(
  worker,
  /recoverableReason\s*=\s*isRecoverable[\s\S]*processErr\s+as\s+any\)\?\.recoverableReason[\s\S]*transient_worker_error/i,
  'worker must preserve the specific recoverable reason for entitlement failures',
);
assert.match(
  worker,
  /inheritedParentExpiryMs[\s\S]*parent_textbook[\s\S]*effective_entitlements/i,
  'past/exam document parent-expiry inheritance must remain distinct from policy-based retention',
);
assert.doesNotMatch(
  worker,
  /from\('au_user_profiles'\)[\s\S]{0,1200}retentionDays/i,
  'worker retention must not fall back to the legacy profile-tier resolver',
);
assert.doesNotMatch(
  worker,
  /isPaidPro\s*\?\s*30\s*:\s*14/i,
  'worker must not keep a parallel Pro-only retention policy',
);

console.log('worker terminal usage-event, authoritative-retention, persistence-gating, plan-attribution, and indexed-chunk metering regression passed');
