
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from './utils';

async function cleanup() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    logger.error('Missing environment variables.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  logger.info('Starting cleanup task...', { threshold: oneDayAgo, now });

  // 1. Failed Jobs Cleanup
  const { data: failedJobs, error } = await supabase
    .from('au_worker_jobs')
    .select('*')
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
              .from(job.bucket || 'documents')
              .remove([job.object_path]);

            if (delError) logger.warn(`Failed to delete storage for job ${job.id}`, delError);
            
            await supabase.from('au_documents')
              .update({ 
                  storage_deleted_at: new Date().toISOString(),
                  cleanup_reason: 'failed_expired'
              })
              .eq('id', job.document_id);
        } catch (e) {
            logger.error(`Error cleaning job ${job.id}`, e);
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
      const attempts = Number(doc.cleanup_attempts || 0) + 1;
      try {
        const { error: delError } = await supabase.storage
          .from('documents')
          .remove([doc.file_path]);

        if (delError) {
          await supabase
            .from('au_documents')
            .update({
              cleanup_pending: true,
              cleanup_attempts: attempts,
              cleanup_last_error: delError.message || String(delError),
              cleanup_last_attempt_at: new Date().toISOString(),
            })
            .eq('id', doc.id);
          continue;
        }

        await supabase
          .from('au_documents')
          .update({
            storage_deleted_at: new Date().toISOString(),
            cleanup_pending: false,
            cleanup_attempts: attempts,
            cleanup_last_error: null,
            cleanup_last_attempt_at: new Date().toISOString(),
          })
          .eq('id', doc.id);
      } catch (e: any) {
        await supabase
          .from('au_documents')
          .update({
            cleanup_pending: true,
            cleanup_attempts: attempts,
            cleanup_last_error: e?.message || String(e),
            cleanup_last_attempt_at: new Date().toISOString(),
          })
          .eq('id', doc.id);
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
          if (doc.file_path) {
              await supabase.storage.from('documents').remove([doc.file_path]);
          }
          await supabase.from('au_documents').update({ status: 'failed', cleanup_reason: 'stale_pending' }).eq('id', doc.id);
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
