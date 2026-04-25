#!/usr/bin/env node

const dotenvOptions = process.env.DOTENV_CONFIG_PATH
  ? { path: process.env.DOTENV_CONFIG_PATH }
  : undefined;
require('dotenv').config(dotenvOptions);

const { createClient } = require('@supabase/supabase-js');
const { QdrantClient } = require('@qdrant/js-client-rest');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const DEFAULT_BUCKET = process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';

const findings = [];

function pushFinding(severity, title, details, remediation) {
  findings.push({
    severity,
    title,
    details,
    remediation,
  });
}

function severityRank(severity) {
  if (severity === 'critical') return 0;
  if (severity === 'high') return 1;
  if (severity === 'medium') return 2;
  return 3;
}

function getErrorMessage(error) {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  return String(error.message || error);
}

function normalizeBucketName(rawBucket, fallbackBucket) {
  return String(rawBucket || '').trim() || fallbackBucket;
}

function isMissingTableError(error) {
  const code = String(error?.code || '');
  const message = getErrorMessage(error).toLowerCase();
  return code === 'PGRST205' || message.includes('could not find the table');
}

async function safeTableQuery(supabase, tableName, options = {}) {
  const {
    columns = '*',
    limit = 200,
    orderBy = 'created_at',
    ascending = false,
  } = options;

  const query = supabase
    .from(tableName)
    .select(columns)
    .limit(limit);

  if (orderBy) {
    query.order(orderBy, { ascending });
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

async function countChunksForDocument(supabase, documentId, ownerId) {
  const strategies = [
    (q) => q.eq('owner_id', ownerId),
    (q) => q.eq('user_id', ownerId),
    (q) => q,
  ];

  for (const apply of strategies) {
    const query = supabase
      .from('au_document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    apply(query);

    const { count, error } = await query;
    if (!error) return { count: Number(count || 0), error: null };
    if (isMissingTableError(error)) return { count: 0, error };

    const message = getErrorMessage(error).toLowerCase();
    if (message.includes('owner_id') || message.includes('user_id')) {
      continue;
    }
    return { count: 0, error };
  }

  return { count: 0, error: new Error('Unable to resolve chunk count query strategy') };
}

async function checkStorageObjectExists(supabase, bucket, filePath) {
  if (!filePath) return { exists: false, error: null };
  const slash = filePath.lastIndexOf('/');
  if (slash <= 0) return { exists: false, error: null };

  const folder = filePath.slice(0, slash);
  const name = filePath.slice(slash + 1);

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, { search: name, limit: 20 });

  if (error) return { exists: false, error };
  const exists = Array.isArray(data) && data.some((item) => item?.name === name);
  return { exists, error: null };
}

function resolveDocumentStorageTarget(jobs, documentId, fallbackPath, fallbackBucket) {
  const matchedJob = (jobs || [])
    .filter((job) => String(job?.document_id || '') === String(documentId || '') && String(job?.object_path || '').trim())
    .sort((a, b) => {
      const aTs = new Date(a?.updated_at || a?.created_at || 0).getTime();
      const bTs = new Date(b?.updated_at || b?.created_at || 0).getTime();
      return bTs - aTs;
    })[0];

  return {
    bucket: normalizeBucketName(matchedJob?.bucket, fallbackBucket),
    filePath: String(matchedJob?.object_path || fallbackPath || '').trim(),
  };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    }, null, 2));
    process.exit(1);
  }

  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const metrics = {
    tables: {},
    statuses: {},
    jobs: {},
    queue: {},
    cleanup: {},
    integrity: {},
    qdrant: {},
    timings: {},
  };

  const tableNames = ['au_documents', 'au_worker_jobs', 'au_document_chunks', 'au_deletion_log', 'au_debug_logs'];
  for (const tableName of tableNames) {
    const { error } = await supabase.from(tableName).select('id', { count: 'exact', head: true }).limit(1);
    metrics.tables[tableName] = error ? { ok: false, error: getErrorMessage(error), code: error?.code || null } : { ok: true };
  }

  if (!metrics.tables.au_document_chunks?.ok) {
    pushFinding(
      'critical',
      'Chunk table is not queryable via PostgREST',
      metrics.tables.au_document_chunks.error,
      'Apply/create migration for public.au_document_chunks and run schema reload.'
    );
  }

  const { data: documents, error: docsError } = await safeTableQuery(supabase, 'au_documents', {
    columns: '*',
    limit: 500,
    orderBy: 'created_at',
  });
  if (docsError) {
    pushFinding('critical', 'Failed to read au_documents', getErrorMessage(docsError), 'Fix table/schema access before running worker.');
  }

  const { data: jobs, error: jobsError } = await safeTableQuery(supabase, 'au_worker_jobs', {
    columns: '*',
    limit: 500,
    orderBy: 'created_at',
  });
  if (jobsError && !isMissingTableError(jobsError)) {
    pushFinding('high', 'Failed to read au_worker_jobs', getErrorMessage(jobsError), 'Verify worker jobs table and permissions.');
  }

  const { data: debugLogs, error: debugLogError } = await safeTableQuery(supabase, 'au_debug_logs', {
    columns: '*',
    limit: 200,
    orderBy: 'created_at',
  });
  if (debugLogError && !isMissingTableError(debugLogError)) {
    pushFinding('medium', 'Failed to read au_debug_logs', getErrorMessage(debugLogError), 'Verify debug log table exists and is accessible.');
  }

  const docStatusAgg = {};
  for (const doc of documents || []) {
    const status = String(doc.status || 'unknown');
    docStatusAgg[status] = (docStatusAgg[status] || 0) + 1;
  }
  metrics.statuses = docStatusAgg;

  const jobStatusAgg = {};
  for (const job of jobs || []) {
    const status = String(job.status || 'unknown');
    jobStatusAgg[status] = (jobStatusAgg[status] || 0) + 1;
  }
  metrics.jobs = jobStatusAgg;

  const now = Date.now();
  const staleQueued = (jobs || []).filter((job) => {
    const status = String(job.status || '');
    if (!['queued', 'uploaded'].includes(status)) return false;
    const updatedAt = new Date(job.updated_at || job.created_at || 0).getTime();
    return Number.isFinite(updatedAt) && now - updatedAt > 10 * 60 * 1000;
  });
  const staleProcessing = (jobs || []).filter((job) => {
    const status = String(job.status || '');
    if (status !== 'processing') return false;
    const updatedAt = new Date(job.updated_at || job.created_at || 0).getTime();
    return Number.isFinite(updatedAt) && now - updatedAt > 15 * 60 * 1000;
  });
  metrics.queue = {
    staleQueued: staleQueued.length,
    staleProcessing: staleProcessing.length,
  };

  if (staleQueued.length > 0) {
    pushFinding(
      'high',
      'Queued jobs are stalled',
      `${staleQueued.length} jobs are queued/uploaded for more than 10 minutes.`,
      'Check worker process health, claim_worker_job RPC, and worker_id routing.'
    );
  }
  if (staleProcessing.length > 0) {
    pushFinding(
      'high',
      'Processing jobs are stale',
      `${staleProcessing.length} jobs are processing for more than 15 minutes.`,
      'Enable lease heartbeat and verify worker host has sufficient CPU/RAM.'
    );
  }

  const completedDocs = (documents || []).filter((doc) => String(doc.status || '').toLowerCase() === 'completed');
  const completedWithoutStorageDelete = completedDocs.filter((doc) => !doc.storage_deleted_at);
  metrics.cleanup = {
    completedDocs: completedDocs.length,
    completedWithoutStorageDelete: completedWithoutStorageDelete.length,
  };

  if (completedWithoutStorageDelete.length > 0) {
    pushFinding(
      'medium',
      'Completed documents still have original storage file',
      `${completedWithoutStorageDelete.length} completed documents have no storage_deleted_at timestamp.`,
      'Run cleanup task and verify storage deletion updates cleanup_pending/cleanup_last_error fields.'
    );
  }

  let qdrantClient = null;
  if (!QDRANT_URL) {
    pushFinding('critical', 'QDRANT_URL is missing', 'Worker cannot write vectors without Qdrant endpoint.', 'Set QDRANT_URL to the Qdrant REST endpoint.');
  } else {
    qdrantClient = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });
    try {
      const collections = await qdrantClient.getCollections();
      metrics.qdrant.collections = (collections.collections || []).map((col) => col.name);
    } catch (error) {
      const message = getErrorMessage(error);
      metrics.qdrant.error = message;
      pushFinding(
        'critical',
        'Qdrant endpoint is unreachable or invalid',
        message,
        'Use the Qdrant cluster REST URL from dashboard (must return /collections with API key).'
      );
      qdrantClient = null;
    }
  }

  const integrityRows = [];
  if (metrics.tables.au_document_chunks?.ok && qdrantClient && completedDocs.length > 0) {
    const sampleDocs = completedDocs.slice(0, 25);
    let mismatches = 0;
    let missingChunkRows = 0;

    for (const doc of sampleDocs) {
      const ownerId = doc.owner_id || doc.user_id;
      const row = {
        documentId: doc.id,
        ownerId: ownerId || null,
        chunkCount: 0,
        qdrantCount: 0,
        ok: false,
        error: null,
      };

      if (!ownerId) {
        row.error = 'missing_owner_id';
        integrityRows.push(row);
        mismatches += 1;
        continue;
      }

      const chunkCountResult = await countChunksForDocument(supabase, doc.id, ownerId);
      if (chunkCountResult.error) {
        row.error = getErrorMessage(chunkCountResult.error);
        integrityRows.push(row);
        mismatches += 1;
        continue;
      }

      row.chunkCount = chunkCountResult.count;
      if (row.chunkCount === 0) {
        missingChunkRows += 1;
      }

      try {
        const qdrantCountRes = await qdrantClient.count('au_chunks', {
          filter: {
            must: [
              { key: 'document_id', match: { value: doc.id } },
            ],
            should: [
              { key: 'owner_id', match: { value: ownerId } },
              { key: 'user_id', match: { value: ownerId } },
            ],
          },
          exact: true,
        });
        row.qdrantCount = Number(qdrantCountRes?.count || 0);
        row.ok = row.chunkCount > 0 && row.qdrantCount === row.chunkCount;
      } catch (error) {
        row.error = getErrorMessage(error);
      }

      if (!row.ok) mismatches += 1;
      integrityRows.push(row);
    }

    metrics.integrity = {
      sampledCompletedDocs: integrityRows.length,
      mismatches,
      missingChunkRows,
    };

    if (missingChunkRows > 0) {
      pushFinding(
        'critical',
        'Completed documents with zero chunk rows',
        `${missingChunkRows} sampled completed documents have no chunk rows.`,
        'Backfill chunks or reprocess affected documents after ensuring au_document_chunks exists.'
      );
    }
    if (mismatches > 0) {
      pushFinding(
        'high',
        'Chunk/vector count mismatch detected',
        `${mismatches} sampled completed documents failed chunk-vs-vector integrity checks.`,
        'Enable strict count verification in worker and reprocess mismatched documents.'
      );
    }
  }

  const cleanupStorageChecks = [];
  for (const doc of (documents || []).slice(0, 25)) {
    if (!doc.file_path) continue;
    if (!doc.storage_deleted_at) continue;
    const storageTarget = resolveDocumentStorageTarget(jobs, doc.id, doc.file_path, DEFAULT_BUCKET);
    const check = await checkStorageObjectExists(supabase, storageTarget.bucket, storageTarget.filePath);
    cleanupStorageChecks.push({
      documentId: doc.id,
      bucket: storageTarget.bucket,
      filePath: storageTarget.filePath,
      existsInBucket: check.exists,
      error: check.error ? getErrorMessage(check.error) : null,
    });
  }
  const falseDeleted = cleanupStorageChecks.filter((item) => item.existsInBucket);
  if (falseDeleted.length > 0) {
    pushFinding(
      'high',
      'Storage deletion metadata mismatch',
      `${falseDeleted.length} documents are marked deleted but object still exists in bucket.`,
      'Fix cleanup flow to set storage_deleted_at only after successful storage.remove.'
    );
  }

  if ((debugLogs || []).length > 0) {
    const workerErrors = debugLogs.filter((log) => {
      const component = String(log.component || '').toLowerCase();
      const message = String(log.message || '').toLowerCase();
      return (
        component.includes('worker') ||
        message.includes('worker')
      ) && (
        message.includes('failed') ||
        message.includes('error')
      );
    });
    metrics.timings.recentWorkerErrorLogs = workerErrors.length;
    if (workerErrors.length > 0) {
      pushFinding(
        'medium',
        'Recent worker error logs detected',
        `${workerErrors.length} recent worker-related errors found in au_debug_logs.`,
        'Inspect log details and confirm retries/recovery behavior is working.'
      );
    }
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const result = {
    ok: findings.filter((f) => f.severity === 'critical').length === 0,
    auditedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    metrics,
    findings,
    samples: {
      staleQueued: staleQueued.slice(0, 10),
      staleProcessing: staleProcessing.slice(0, 10),
      integrity: integrityRows.slice(0, 25),
      cleanupStorageChecks: cleanupStorageChecks.slice(0, 25),
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: getErrorMessage(error),
    stack: error?.stack || null,
  }, null, 2));
  process.exit(1);
});
