
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from './utils';

function resolveBucket(): string {
  return process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
            logger.info(`Cleaning up storage for job ${job.id}`, { path: job.object_path });
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

  const { data: pendingCleanup, error: pendingCleanupError } = await supabase
    .from('au_documents')
    .select('id,file_path,storage_deleted_at,cleanup_attempts')
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
        logger.info('Retrying pending cleanup', { documentId: doc.id, filePath: doc.file_path });
        const { error: delError } = await supabase.storage
          .from(bucket)
          .remove([doc.file_path]);

        if (delError) {
          await updateCleanupState(doc.id, {
            success: false,
            reason: 'retry_pending_cleanup',
            error: delError.message || String(delError),
            currentAttempts: doc.cleanup_attempts || 0,
          });
          continue;
        }

        await updateCleanupState(doc.id, {
          success: true,
          reason: 'retry_pending_cleanup',
          currentAttempts: doc.cleanup_attempts || 0,
        });
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

  // 3. Retention Purge (Expired Documents)
  // This triggers the DB 'AFTER DELETE' trigger, which inserts into au_deletion_log.
  // The RAGWorker (running continuously) will pick up the log and delete vectors from Qdrant.
  const { data: expiredDocs, error: expireError } = await supabase
    .from('au_documents')
    .select('id, file_name')
    .lt('expires_at', now);
    
  if (expireError) {
      logger.error('Failed to fetch expired documents', expireError);
  } else if (expiredDocs && expiredDocs.length > 0) {
      logger.info(`Found ${expiredDocs.length} expired documents to purge`);
      for (const doc of expiredDocs) {
          logger.info(`Purging expired document: ${doc.file_name} (${doc.id})`);
          // Deleting row triggers cleanup workflow
          await supabase.from('au_documents').delete().eq('id', doc.id);
      }
  } else {
      logger.info('No expired documents found.');
  }

  logger.info('Cleanup complete');
}

cleanup().catch(err => {
  logger.error('Cleanup crashed', err);
  process.exit(1);
});
