#!/usr/bin/env node

const dotenvOptions = process.env.DOTENV_CONFIG_PATH
  ? { path: process.env.DOTENV_CONFIG_PATH }
  : undefined;
require('dotenv').config(dotenvOptions);

const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { spawnSync } = require('child_process');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';
const OWNER_ID = process.env.SMOKE_OWNER_ID || process.env.TEST_OWNER_ID;
const WORKER_ID = process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 240000);
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 3000);
const transformersModel = (process.env.TRANSFORMERS_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2').trim();
const transformersEnabledRaw = String(process.env.TRANSFORMERS_FALLBACK_ENABLED ?? 'true').toLowerCase();
const transformersEnabled = !(transformersEnabledRaw === 'false' || transformersEnabledRaw === '0' || transformersEnabledRaw === 'no');

function fail(message, details) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message,
        details: details || null,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRequiredInputs() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    fail('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!OWNER_ID) {
    fail('Missing SMOKE_OWNER_ID (or TEST_OWNER_ID). Set this to a valid AU user id.');
  }
  if (!transformersEnabled) {
    fail('TRANSFORMERS_FALLBACK_ENABLED must be true for transformers-only smoke test.');
  }
}

function assertWorkerLogs(logs) {
  if (/FastEmbed model archive/i.test(logs)) {
    fail('Smoke assertion failed: FastEmbed archive logs found while transformers-only mode is enabled.');
  }

  if (!logs.includes('Transformers-only embedder mode enabled; FastEmbed initialization skipped')) {
    fail('Smoke assertion failed: transformers-only mode log not found.');
  }

  if (!logs.includes('Initializing Transformers fallback embedder')) {
    fail('Smoke assertion failed: transformers embedder initialization log not found.');
  }

  if (!logs.includes(`"model":"${transformersModel}"`)) {
    fail('Smoke assertion failed: expected transformers model id not found in logs.', {
      expectedModel: transformersModel,
    });
  }

  if (!logs.includes('"embedder":"transformers"')) {
    fail('Smoke assertion failed: completion log does not report transformers embedder.');
  }
}

async function pollJobUntilDone(supabase, jobId, deadlineTs) {
  while (Date.now() < deadlineTs) {
    const { data, error } = await supabase
      .from('au_worker_jobs')
      .select('id,status,error,updated_at,document_id')
      .eq('id', jobId)
      .maybeSingle();

    if (error) {
      fail('Failed to read smoke worker job status', { message: error.message, code: error.code });
    }
    if (!data) {
      fail('Smoke worker job row disappeared unexpectedly', { jobId });
    }

    const status = String(data.status || '').toLowerCase();
    if (status === 'completed') return data;
    if (status === 'failed') {
      fail('Smoke worker job failed', { jobId, error: data.error || null });
    }

    await wait(POLL_MS);
  }

  fail('Smoke worker job timed out', { timeoutMs: TIMEOUT_MS, jobId });
}

async function assertStorageDeleted(supabase, objectPath) {
  const slash = objectPath.lastIndexOf('/');
  const folder = slash > 0 ? objectPath.slice(0, slash) : '';
  const name = slash > 0 ? objectPath.slice(slash + 1) : objectPath;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, { search: name, limit: 10 });

  if (error) {
    fail('Failed to verify storage cleanup', { message: error.message, bucket: BUCKET, objectPath });
  }

  const exists = Array.isArray(data) && data.some((item) => item?.name === name);
  if (exists) {
    fail('Smoke assertion failed: uploaded file still exists in storage after completed ingestion.', {
      bucket: BUCKET,
      objectPath,
    });
  }
}

function readWorkerLogsSince(sinceIso) {
  const proc = spawnSync('docker', ['compose', 'logs', '--since', sinceIso, 'worker'], {
    encoding: 'utf8',
  });

  if (proc.error) {
    fail('Failed to execute `docker compose logs` for smoke assertions.', {
      message: proc.error.message,
    });
  }

  const output = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  return output;
}

async function main() {
  await ensureRequiredInputs();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = new Date();
  const documentId = randomUUID();
  const jobId = randomUUID();
  const fileName = `transformers-smoke-${documentId}.txt`;
  const objectPath = `${OWNER_ID}/ingestion/main-textbooks/${fileName}`;
  const expiresAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const fileContent = Buffer.from(
    'Datacube AU transformers smoke test.\nThis file verifies transformers-only embeddings and cleanup.\n',
    'utf8',
  );

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, fileContent, {
      upsert: true,
      contentType: 'text/plain',
    });
  if (uploadError) {
    fail('Failed to upload smoke test file to storage.', {
      message: uploadError.message,
      bucket: BUCKET,
      objectPath,
    });
  }

  const { error: documentError } = await supabase.from('au_documents').upsert({
    id: documentId,
    owner_id: OWNER_ID,
    user_id: OWNER_ID,
    file_name: fileName,
    file_path: objectPath,
    document_type: 'main_textbook',
    status: 'uploaded',
    metadata: { smoke_test: true, smoke_script: 'smoke-transformers-mode.cjs' },
    expires_at: expiresAtIso,
    storage_deleted_at: null,
  });
  if (documentError) {
    fail('Failed to insert smoke au_documents row.', {
      message: documentError.message,
      code: documentError.code,
    });
  }

  const nowIso = new Date().toISOString();
  const { error: jobError } = await supabase.from('au_worker_jobs').upsert({
    id: jobId,
    document_id: documentId,
    owner_id: OWNER_ID,
    user_id: OWNER_ID,
    file_name: fileName,
    mime_type: 'text/plain',
    file_size_bytes: fileContent.length,
    bucket: BUCKET,
    object_path: objectPath,
    status: 'queued',
    progress: 0,
    worker_id: WORKER_ID,
    metadata: { smoke_test: true, smoke_script: 'smoke-transformers-mode.cjs' },
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (jobError) {
    fail('Failed to insert smoke au_worker_jobs row.', {
      message: jobError.message,
      code: jobError.code,
    });
  }

  const completedJob = await pollJobUntilDone(supabase, jobId, startedAt.getTime() + TIMEOUT_MS);

  const { data: docAfter, error: docAfterError } = await supabase
    .from('au_documents')
    .select('id,status,error,storage_deleted_at')
    .eq('id', documentId)
    .maybeSingle();
  if (docAfterError) {
    fail('Failed to read smoke document status after completion.', {
      message: docAfterError.message,
      code: docAfterError.code,
    });
  }
  if (!docAfter || String(docAfter.status || '').toLowerCase() !== 'completed') {
    fail('Smoke assertion failed: au_documents row is not completed after job completion.', {
      documentId,
      status: docAfter?.status || null,
      error: docAfter?.error || null,
    });
  }

  await assertStorageDeleted(supabase, objectPath);

  const logs = readWorkerLogsSince(startedAt.toISOString());
  assertWorkerLogs(logs);

  console.log(
    JSON.stringify(
      {
        ok: true,
        message: 'Transformers-only smoke test passed.',
        jobId: completedJob.id,
        documentId,
        bucket: BUCKET,
        objectPath,
        model: transformersModel,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  fail('Unexpected smoke test error.', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
  });
});
