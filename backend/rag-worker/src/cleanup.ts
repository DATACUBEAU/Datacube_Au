
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from './utils';
import { isProtectedOwnerUserId } from './protected-owner';

function resolveBucket(): string {
  return process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';
}

function normalizeBucketName(rawBucket: unknown, fallbackBucket: string, context: Record<string, unknown>): string {
  const candidate = String(rawBucket || '').trim() || fallbackBucket;
  if (candidate !== fallbackBucket) {
    logger.warn('Non-canonical storage bucket encountered during cleanup; using recorded bucket for compatibility', {
      ...context,
      expectedBucket: fallbackBucket,
      actualBucket: candidate,
    });
  }
  return candidate;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isStorageMissingError(error: any): boolean {
  const status = Number(error?.statusCode || error?.status || 0);
  const code = String(error?.code || '').trim().toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    status === 404 ||
    code === '404' ||
    code === 'not_found' ||
    message.includes('not found') ||
    message.includes('no such file') ||
    message.includes('does not exist')
  );
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

  const resolveDocumentStorageTarget = async (
    documentId: string,
    fallbackPath: string | null | undefined,
  ): Promise<{ bucket: string; objectPath: string }> => {
    const fallbackObjectPath = String(fallbackPath || '').trim();

    try {
      const { data, error } = await supabase
        .from('au_worker_jobs')
        .select('bucket,object_path,updated_at')
        .eq('document_id', documentId)
        .not('object_path', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.warn('Failed to resolve document storage target from worker jobs; using fallback path', {
          documentId,
          message: error.message,
        });
        return {
          bucket,
          objectPath: fallbackObjectPath,
        };
      }

      return {
        bucket: normalizeBucketName((data as any)?.bucket, bucket, {
          documentId,
          source: 'cleanup-resolver',
        }),
        objectPath: String((data as any)?.object_path || fallbackObjectPath).trim(),
      };
    } catch (error) {
      logger.warn('Document storage target resolution threw; using fallback path', {
        documentId,
        message: toErrorMessage(error),
      });
      return {
        bucket,
        objectPath: fallbackObjectPath,
      };
    }
  };

  const updateCleanupState = async (
    documentId: string,
    options: {
      success: boolean;
      reason?: string | null;
      error?: string | null;
      currentAttempts?: number;
      nextStatus?: string | null;
      sourceCleanupResult?: string | null;
    }
  ) => {
    const attempts = Number(options.currentAttempts || 0) + 1;
    const payload: Record<string, unknown> = {
      cleanup_attempts: attempts,
      cleanup_last_attempt_at: new Date().toISOString(),
      cleanup_reason: options.reason ?? null,
      source_cleanup_result: options.sourceCleanupResult ?? (options.success ? 'deleted' : 'delete_failed'),
    };

    if (options.success) {
      payload.storage_deleted_at = new Date().toISOString();
      payload.source_deleted_at = new Date().toISOString();
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
    .select('id,document_id,owner_id,user_id,object_path,bucket,updated_at')
    .eq('status', 'failed')
    .lt('updated_at', oneDayAgo);
    
  if (error) {
    logger.error('Failed to fetch failed jobs', error);
  } else {
    logger.info(`Found ${failedJobs?.length || 0} failed jobs to cleanup`);

    for (const job of failedJobs || []) {
        if (isProtectedOwnerUserId((job as any).owner_id || (job as any).user_id)) {
          logger.warn('Skipping failed-job cleanup for protected owner document', {
            jobId: job.id,
            documentId: job.document_id,
            ownerId: (job as any).owner_id || (job as any).user_id,
          });
          continue;
        }
        if (!job.object_path) continue;
        try {
            logger.info(`Cleaning up storage for job ${job.id}`, { path: job.object_path });
            const { error: delError } = await supabase.storage
              .from(normalizeBucketName(job.bucket, bucket, {
                jobId: job.id,
                documentId: job.document_id,
                source: 'failed-job-cleanup',
              }))
              .remove([job.object_path]);

            if (delError) {
              if (isStorageMissingError(delError)) {
                await updateCleanupState(job.document_id, {
                  success: true,
                  reason: 'failed_expired',
                  sourceCleanupResult: 'missing',
                });
                continue;
              }
              logger.warn(`Failed to delete storage for job ${job.id}`, delError);
              await updateCleanupState(job.document_id, {
                success: false,
                reason: 'failed_expired',
                error: delError.message || String(delError),
                sourceCleanupResult: 'delete_failed',
              });
              continue;
            }

            await updateCleanupState(job.document_id, {
              success: true,
              reason: 'failed_expired',
              sourceCleanupResult: 'deleted',
            });
        } catch (e) {
            logger.error(`Error cleaning job ${job.id}`, e);
            await updateCleanupState(job.document_id, {
              success: false,
              reason: 'failed_expired',
              error: toErrorMessage(e),
              sourceCleanupResult: 'delete_failed',
            });
        }
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
      if (isProtectedOwnerUserId((doc as any).owner_id || (doc as any).user_id)) {
        logger.warn('Skipping pending source cleanup for protected owner document', {
          documentId: doc.id,
          ownerId: (doc as any).owner_id || (doc as any).user_id,
        });
        continue;
      }

      const storageTarget = await resolveDocumentStorageTarget(doc.id, doc.file_path);
      if (!storageTarget.objectPath) continue;
      try {
        logger.info('Retrying pending cleanup', {
          documentId: doc.id,
          bucket: storageTarget.bucket,
          filePath: storageTarget.objectPath,
        });
        const { error: delError } = await supabase.storage
          .from(storageTarget.bucket)
          .remove([storageTarget.objectPath]);

        if (delError) {
          if (isStorageMissingError(delError)) {
            await updateCleanupState(doc.id, {
              success: true,
              reason: 'retry_pending_cleanup',
              currentAttempts: doc.cleanup_attempts || 0,
              sourceCleanupResult: 'missing',
            });
            continue;
          }
          await updateCleanupState(doc.id, {
            success: false,
            reason: 'retry_pending_cleanup',
            error: delError.message || String(delError),
            currentAttempts: doc.cleanup_attempts || 0,
            sourceCleanupResult: 'delete_failed',
          });
          continue;
        }

        await updateCleanupState(doc.id, {
          success: true,
          reason: 'retry_pending_cleanup',
          currentAttempts: doc.cleanup_attempts || 0,
          sourceCleanupResult: 'deleted',
        });
      } catch (e: any) {
        await updateCleanupState(doc.id, {
          success: false,
          reason: 'retry_pending_cleanup',
          error: e?.message || String(e),
          currentAttempts: doc.cleanup_attempts || 0,
          sourceCleanupResult: 'delete_failed',
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
          if (isProtectedOwnerUserId((doc as any).owner_id || (doc as any).user_id)) {
            logger.warn('Skipping stale pending upload cleanup for protected owner document', {
              documentId: doc.id,
              ownerId: (doc as any).owner_id || (doc as any).user_id,
            });
            continue;
          }

          let deleted = false;
          let deletionError: string | null = null;
          let sourceCleanupResult: string = 'no_source';
          const storageTarget = await resolveDocumentStorageTarget(doc.id, doc.file_path);
          if (storageTarget.objectPath) {
              const { error: delError } = await supabase.storage.from(storageTarget.bucket).remove([storageTarget.objectPath]);
              if (delError) {
                if (isStorageMissingError(delError)) {
                  deleted = true;
                  sourceCleanupResult = 'missing';
                } else {
                  deletionError = delError.message || String(delError);
                  sourceCleanupResult = 'delete_failed';
                }
              } else {
                deleted = true;
                sourceCleanupResult = 'deleted';
              }
          }
          await updateCleanupState(doc.id, {
            success: deleted,
            reason: 'stale_pending',
            error: deletionError,
            currentAttempts: doc.cleanup_attempts || 0,
            nextStatus: 'failed',
            sourceCleanupResult,
          });
          if (!deleted && !deletionError) {
            await supabase
              .from('au_documents')
              .update({ status: 'failed', cleanup_reason: 'stale_pending' })
              .eq('id', doc.id);
          }
      }
  }

  logger.info(
    'Retention cleanup execution is now owned by the protected /api/cron/retention route. This script only handles stale uploads and failed-job storage cleanup.',
  );

  logger.info('Cleanup complete');
}

cleanup().catch(err => {
  logger.error('Cleanup crashed', err);
  process.exit(1);
});
