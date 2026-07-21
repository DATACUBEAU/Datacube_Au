
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from './utils';
import { isJobOlderThan } from './job-recovery';
import { finalizeDocumentSourceCleanup } from './source-cleanup';

function resolveBucket(): string {
  return process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isMissingColumnError(error: any, column: string): boolean {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const target = column.toLowerCase();
  return (message.includes(target) && message.includes('does not exist')) ||
    (details.includes(target) && details.includes('does not exist'));
}

async function cleanup() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = resolveBucket();

  if (!supabaseUrl || !supabaseServiceKey) {
    logger.error('Missing environment variables.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  logger.info('Starting cleanup task...', { threshold: oneDayAgo, now, bucket });

  const updateCleanupState = async (
    documentId: string,
    options: {
      success: boolean;
      reason?: string | null;
      error?: string | null;
      currentAttempts?: number;
      nextStatus?: string | null;
    }
  ) => {
    const attempts = Number(options.currentAttempts || 0) + 1;
    const payload: Record<string, unknown> = {
      cleanup_attempts: attempts,
      cleanup_last_attempt_at: new Date().toISOString(),
      cleanup_reason: options.reason ?? null,
    };

    if (options.success) {
      payload.storage_deleted_at = new Date().toISOString();
      payload.cleanup_pending = false;
      payload.cleanup_last_error = null;
    } else {
      payload.cleanup_pending = true;
      payload.cleanup_last_error = options.error || 'cleanup_failed';
    }

    if (options.nextStatus) {
      payload.status = options.nextStatus;
    }

    await supabase
      .from('au_documents')
      .update(payload)
      .eq('id', documentId);
  };

  const updateWorkerJob = async (
    jobId: string,
    payload: Record<string, unknown>,
    fallbackColumns: string[] = [],
  ) => {
    const { error } = await supabase
      .from('au_worker_jobs')
      .update(payload)
      .eq('id', jobId);
    if (!error) return null;

    const missingColumns = fallbackColumns.filter((column) => isMissingColumnError(error, column));
    if (missingColumns.length === 0) return error;

    const nextPayload = { ...payload };
    for (const column of missingColumns) {
      delete (nextPayload as any)[column];
    }

    const { error: retryError } = await supabase
      .from('au_worker_jobs')
      .update(nextPayload)
      .eq('id', jobId);
    return retryError ?? null;
  };

  const reconcileTerminalClaimedJobs = async () => {
    const { data, error } = await supabase
      .from('au_worker_jobs')
      .select('id')
      .in('status', ['failed', 'completed'])
      .not('claimed_by', 'is', null)
      .limit(200);

    if (error) {
      logger.warn('Failed to scan terminal jobs with stale claims', { message: error.message });
      return;
    }

    const ids = (data || []).map((row: any) => String(row?.id || '').trim()).filter(Boolean);
    if (ids.length === 0) return;

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('au_worker_jobs')
      .update({
        claimed_by: null,
        locked_at: null,
        locked_until: null,
        updated_at: nowIso,
      })
      .in('id', ids);

    if (updateError) {
      logger.warn('Failed to reconcile terminal claims in cleanup task', {
        message: updateError.message,
        count: ids.length,
      });
      return;
    }

    logger.info('Cleanup reconciled terminal jobs with stale claims', { count: ids.length });
  };

  await reconcileTerminalClaimedJobs();

  // 1. Failed Jobs Cleanup
  const { data: failedJobs, error } = await supabase
    .from('au_worker_jobs')
    .select('id,document_id,object_path,bucket,updated_at')
    .eq('status', 'failed')
    .lt('updated_at', oneDayAgo);
    
  if (error) {
    logger.error('Failed to fetch failed jobs', error);
  } else {
    logger.info(`Found ${failedJobs?.length || 0} failed jobs to cleanup`);

    for (const job of failedJobs || []) {
        if (!job.object_path) continue;
        try {
            logger.info('Cleaning up storage for expired failed job', {
              jobId: job.id,
              documentId: job.document_id,
            });
            const { error: delError } = await supabase.storage
              .from(job.bucket || bucket)
              .remove([job.object_path]);

            if (delError) {
              logger.warn(`Failed to delete storage for job ${job.id}`, delError);
              await updateCleanupState(job.document_id, {
                success: false,
                reason: 'failed_expired',
                error: delError.message || String(delError),
              });
              continue;
            }

            await updateCleanupState(job.document_id, {
              success: true,
              reason: 'failed_expired',
            });
        } catch (e) {
            logger.error(`Error cleaning job ${job.id}`, e);
            await updateCleanupState(job.document_id, {
              success: false,
              reason: 'failed_expired',
              error: toErrorMessage(e),
            });
        }
    }
  }

  const processingThresholdMs = Math.max(5 * 60 * 1000, Number(process.env.PROCESSING_RECONCILE_MS || 5 * 60 * 1000));
  const staleThresholdMs = Math.max(15 * 60 * 1000, Number(process.env.PROCESSING_STALE_MS || 20 * 60 * 1000));
  const staleBeforeMs = Date.now() - staleThresholdMs;
  const staleBefore = new Date(staleBeforeMs).toISOString();

  const { data: processingJobs, error: processingError } = await supabase
    .from('au_worker_jobs')
    .select('id,document_id,progress,updated_at,locked_until,owner_id,user_id')
    .eq('status', 'processing')
    .order('updated_at', { ascending: true })
    .limit(100);

  if (processingError) {
    logger.error('Failed to fetch processing jobs for reconciliation', processingError);
  } else if (processingJobs && processingJobs.length > 0) {
    const docIds = Array.from(new Set(processingJobs.map((job: any) => String(job.document_id || '')).filter(Boolean)));
    const { data: docRows } = await supabase
      .from('au_documents')
      .select('id,status')
      .in('id', docIds);
    const docMap = new Map<string, string>();
    for (const row of docRows || []) {
      if (!row?.id) continue;
      docMap.set(String(row.id), String(row.status || '').toLowerCase());
    }

    for (const job of processingJobs) {
      const docStatus = docMap.get(String(job.document_id || '')) || '';
      const shouldReconcile = isJobOlderThan(job.updated_at, processingThresholdMs);
      const hasCompletedDoc = docStatus === 'completed' || docStatus === 'done' || docStatus === 'indexed';

      if (hasCompletedDoc) {
        await updateWorkerJob(job.id, {
          status: 'completed',
          progress: 100,
          error: null,
          claimed_by: null,
          locked_at: null,
          locked_until: null,
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }, ['completed_at', 'error', 'claimed_by']);
        continue;
      }

      if (shouldReconcile && Number(job.progress || 0) >= 95 && job.document_id) {
        const { count } = await supabase
          .from('au_document_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', job.document_id);
        if (Number(count || 0) > 0) {
          await updateWorkerJob(job.id, {
            status: 'completed',
            progress: 100,
            error: null,
            claimed_by: null,
            locked_at: null,
            locked_until: null,
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }, ['completed_at', 'error', 'claimed_by']);
        }
      }
    }
  }

  const { data: staleJobs, error: staleJobsError } = await supabase
    .from('au_worker_jobs')
    .select('id,document_id,updated_at,locked_until')
    .eq('status', 'processing')
    .lt('updated_at', staleBefore)
    .limit(100);

  if (staleJobsError) {
    logger.error('Failed to fetch stale jobs', staleJobsError);
  } else if (staleJobs && staleJobs.length > 0) {
    for (const job of staleJobs) {
      if (!job.document_id) continue;
      const nowIso = new Date().toISOString();
      await updateWorkerJob(job.id, {
        status: 'stale_timeout',
        error: 'stale_timeout',
        claimed_by: null,
        locked_at: null,
        locked_until: null,
        updated_at: nowIso,
      }, ['error', 'claimed_by']);
      await supabase
        .from('au_documents')
        .update({ status: 'failed', error: 'stale_timeout' })
        .eq('id', job.document_id);
    }
  }

  const { data: pendingCleanup, error: pendingCleanupError } = await supabase
    .from('au_documents')
    .select('id,owner_id,user_id,file_path,storage_deleted_at,cleanup_attempts')
    .eq('cleanup_pending', true)
    .eq('status', 'completed')
    .is('storage_deleted_at', null)
    .limit(50);

  if (pendingCleanupError) {
    logger.error('Failed to fetch cleanup_pending documents', pendingCleanupError);
  } else if (pendingCleanup && pendingCleanup.length > 0) {
    for (const doc of pendingCleanup) {
      if (!doc.file_path) continue;
      try {
        logger.info('Retrying pending cleanup', { documentId: doc.id });
        const cleanupResult = await finalizeDocumentSourceCleanup({
          supabase,
          documentId: doc.id,
          preferredObjectPath: String(doc.file_path || '').trim() || null,
          expectedOwnerId: String(doc.owner_id || doc.user_id || '').trim() || null,
          defaultBucket: bucket,
        });
        if (!cleanupResult.success) {
          logger.warn('Pending cleanup retry did not delete source file', {
            documentId: doc.id,
            cleanupCode: cleanupResult.code,
            cleanupAttempts: cleanupResult.attempts,
          });
        }
      } catch (e: any) {
        await updateCleanupState(doc.id, {
          success: false,
          reason: 'retry_pending_cleanup',
          error: e?.message || String(e),
          currentAttempts: doc.cleanup_attempts || 0,
        });
      }
    }
  }
  
  // 2. Stale Pending Uploads
  const { data: staleDocs, error: staleError } = await supabase
    .from('au_documents')
    .select('*')
    .eq('status', 'pending_upload')
    .lt('created_at', oneDayAgo);
    
  if (staleDocs && staleDocs.length > 0) {
      logger.info(`Found ${staleDocs.length} stale pending uploads`);
      for (const doc of staleDocs) {
          let deleted = false;
          let deletionError: string | null = null;
          if (doc.file_path) {
              const { error: delError } = await supabase.storage.from(bucket).remove([doc.file_path]);
              if (delError) {
                deletionError = delError.message || String(delError);
              } else {
                deleted = true;
              }
          }
          await updateCleanupState(doc.id, {
            success: deleted,
            reason: 'stale_pending',
            error: deletionError,
            currentAttempts: doc.cleanup_attempts || 0,
            nextStatus: 'failed',
          });
          if (!deleted && !deletionError) {
            await supabase
              .from('au_documents')
              .update({ status: 'failed', cleanup_reason: 'stale_pending' })
              .eq('id', doc.id);
          }
      }
  }

  logger.info('Retention purge is handled by the protected /api/cron/retention backend pipeline.');

  logger.info('Cleanup complete');
}

cleanup().catch(err => {
  logger.error('Cleanup crashed', err);
  process.exit(1);
});
