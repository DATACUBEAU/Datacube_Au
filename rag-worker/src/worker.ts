import { SupabaseClient } from '@supabase/supabase-js';
import { IngestionService } from './ingestion';
import { logger, deterministicChunking } from './utils';
import { UploadJob } from './types';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

export class RAGWorker {
  private isRunning = false;
  private pipelineId: string;
  private workerInstanceId: string;

  constructor(
    private supabase: SupabaseClient,
    private ingestion: IngestionService,
  ) {
    this.pipelineId = process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker';
    this.workerInstanceId =
      process.env.WORKER_INSTANCE_ID ||
      `${this.pipelineId}-${process.env.HOSTNAME || Math.random().toString(36).substring(7)}`;
  }

  async start() {
    this.isRunning = true;
    logger.info('Worker started', { pipelineId: this.pipelineId, workerId: this.workerInstanceId });

    while (this.isRunning) {
      try {
        await Promise.all([
          this.pollJobs(),
          this.pollDeletions(),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        logger.error('Worker loop error', err);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  stop() {
    this.isRunning = false;
    logger.info('Worker stopping');
  }

  private isMissingRpcError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('claim_worker_job') &&
      (
        message.includes('does not exist') ||
        message.includes('not found') ||
        message.includes('undefined function')
      )
    );
  }

  private isMissingColumnError(error: any, column: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return (
      message.includes(column.toLowerCase()) && message.includes('does not exist')
    ) || (
      details.includes(column.toLowerCase()) && details.includes('does not exist')
    );
  }

  private normalizeClaimedJob(raw: any): UploadJob | null {
    if (!raw || !raw.id || !raw.document_id) {
      return null;
    }

    const ownerId = String(raw.owner_id || raw.user_id || '').trim();
    if (!ownerId) {
      logger.warn('Skipping claimed job without owner_id/user_id', { jobId: raw.id });
      return null;
    }

    const objectPath = String(raw.object_path || '').trim();
    if (!objectPath) {
      logger.warn('Skipping claimed job without object_path', { jobId: raw.id });
      return null;
    }

    return {
      ...raw,
      owner_id: ownerId,
      bucket: String(raw.bucket || 'documents'),
      object_path: objectPath,
    };
  }

  private async claimJob(): Promise<UploadJob | null> {
    // Preferred path: atomic DB function.
    const { data: rpcJobs, error: rpcError } = await this.supabase.rpc('claim_worker_job', {
      p_worker_id: this.workerInstanceId,
      p_lease_duration_ms: 300000, // 5 minutes
    });

    if (!rpcError && Array.isArray(rpcJobs) && rpcJobs.length > 0) {
      return this.normalizeClaimedJob(rpcJobs[0]);
    }

    if (rpcError && !this.isMissingRpcError(rpcError)) {
      throw rpcError;
    }

    if (rpcError) {
      logger.warn('claim_worker_job RPC unavailable, using fallback claim strategy', {
        message: rpcError.message,
      });
    }

    // Fallback path: optimistic claim via row update.
    const { data: candidate, error: candidateError } = await this.supabase
      .from('au_worker_jobs')
      .select('*')
      .in('status', ['queued', 'uploaded'])
      .or(`worker_id.eq.${this.pipelineId},worker_id.is.null`)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (candidateError) {
      throw candidateError;
    }
    if (!candidate) {
      return null;
    }

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 300000).toISOString();
    const { data: claimed, error: claimError } = await this.supabase
      .from('au_worker_jobs')
      .update({
        status: 'processing',
        progress: 10,
        worker_id: candidate.worker_id || this.pipelineId,
        locked_at: now.toISOString(),
        locked_until: leaseUntil,
        claimed_by: this.workerInstanceId,
        updated_at: now.toISOString(),
      })
      .eq('id', candidate.id)
      .in('status', ['queued', 'uploaded'])
      .select('*')
      .maybeSingle();

    if (claimError) {
      throw claimError;
    }
    if (!claimed) {
      return null;
    }

    return this.normalizeClaimedJob(claimed);
  }

  private async markJobFailed(jobId: string, errorMessage: string) {
    const payload = {
      status: 'failed',
      error: errorMessage,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('au_worker_jobs')
      .update(payload)
      .eq('id', jobId);

    if (error && this.isMissingColumnError(error, 'error')) {
      await this.supabase
        .from('au_worker_jobs')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      return;
    }

    if (error) {
      logger.error('Failed to mark job as failed', { jobId, error: error.message });
    }
  }

  private async pollDeletions() {
    const { data: logs, error } = await this.supabase
      .from('au_deletion_log')
      .select('*')
      .eq('processed', false)
      .limit(10);

    if (error) {
      logger.error('Error polling deletion logs', error);
      return;
    }
    if (!logs || logs.length === 0) return;

    logger.info(`Found ${logs.length} documents to delete`);

    for (const log of logs) {
      try {
        await this.ingestion.deleteDocument(log.document_id);

        if (log.file_path) {
          const { error: storageError } = await this.supabase.storage
            .from('documents')
            .remove([log.file_path]);
          if (storageError) {
            logger.warn(`Storage deletion warning for ${log.document_id}`, storageError);
          }
        }

        await this.supabase
          .from('au_deletion_log')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('id', log.id);

        logger.info(`Processed deletion for ${log.document_id}`);
      } catch (e) {
        logger.error(`Failed to process deletion for ${log.document_id}`, e);
      }
    }
  }

  private async pollJobs() {
    const currentJob = await this.claimJob();
    if (!currentJob) {
      return;
    }

    logger.info('Job claimed', { jobId: currentJob.id, documentId: currentJob.document_id });

    await this.supabase.from('au_debug_logs').insert({
      component: 'rag-worker',
      message: 'Job claimed',
      details: { jobId: currentJob.id, workerId: this.workerInstanceId, pipelineId: this.pipelineId },
    });

    try {
      await this.processJob(currentJob);

      await this.supabase
        .from('au_worker_jobs')
        .update({
          status: 'completed',
          progress: 100,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentJob.id);

      logger.info('Job completed', { jobId: currentJob.id });

      await this.supabase.from('au_debug_logs').insert({
        component: 'rag-worker',
        message: 'Job completed',
        details: { jobId: currentJob.id },
      });

      try {
        logger.info('Deleting file from Supabase Storage', { bucket: currentJob.bucket, path: currentJob.object_path });
        const { error: deleteError } = await this.supabase.storage
          .from(currentJob.bucket)
          .remove([currentJob.object_path]);

        if (deleteError) {
          logger.error('Failed to delete file from storage', deleteError);
        } else {
          logger.info('File deleted successfully');
          await this.supabase
            .from('au_documents')
            .update({ storage_deleted_at: new Date().toISOString() })
            .eq('id', currentJob.document_id);
        }
      } catch (delErr) {
        logger.error('Failed to delete file (exception)', delErr);
      }
    } catch (processErr) {
      logger.error('Job failed', { jobId: currentJob.id, error: processErr });

      const errorMessage = processErr instanceof Error ? processErr.message : String(processErr);

      await this.supabase.from('au_debug_logs').insert({
        component: 'rag-worker',
        message: 'Job failed',
        details: {
          jobId: currentJob.id,
          error: errorMessage,
          stack: processErr instanceof Error ? processErr.stack : null,
        },
      });

      await this.markJobFailed(currentJob.id, errorMessage);
    }
  }

  private async processJob(job: UploadJob) {
    const ownerId = String(job.owner_id || job.user_id || '').trim();
    if (!ownerId) {
      throw new Error('Missing owner_id/user_id for job processing.');
    }

    logger.info('Downloading file', { bucket: job.bucket, path: job.object_path });
    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from(job.bucket)
      .download(job.object_path);

    if (downloadError) throw downloadError;

    let text = '';
    const buffer = Buffer.from(await fileData.arrayBuffer());
    const extension = job.object_path.split('.').pop()?.toLowerCase();

    if (extension === 'pdf') {
      const pdfData = await (pdf as any)(buffer);
      text = pdfData.text;
    } else if (extension === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      text = buffer.toString('utf-8');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('No text content extracted from document');
    }

    const chunks = deterministicChunking(text);

    // Retention policy:
    // - Billing disabled (promo mode): 14 days for everyone
    // - Billing enabled + paid pro: 30 days
    // - Otherwise: 14 days
    const now = new Date();
    const [{ data: profile }, { data: conexConfig }, { data: legacyConfig }] = await Promise.all([
      this.supabase
        .from('au_user_profiles')
        .select('tier,tier_expires_at')
        .eq('user_id', ownerId)
        .maybeSingle(),
      this.supabase
        .from('au_conex_config')
        .select('billing_enabled')
        .eq('id', 1)
        .maybeSingle(),
      this.supabase
        .from('au_config')
        .select('billing_enabled')
        .limit(1)
        .maybeSingle(),
    ]);

    const billingEnabled = conexConfig?.billing_enabled ?? legacyConfig?.billing_enabled ?? true;
    const tier = String(profile?.tier || 'free').toLowerCase();
    const tierExpiry = profile?.tier_expires_at ? new Date(profile.tier_expires_at) : null;

    let isPaidPro = false;
    if (billingEnabled && tier === 'pro') {
      if (!tierExpiry || tierExpiry > now) {
        isPaidPro = true;
      } else {
        const { data: activeSubscription } = await this.supabase
          .from('au_subscriptions')
          .select('id')
          .eq('owner_id', ownerId)
          .in('status', ['active', 'non_renewing'])
          .gt('current_period_end', now.toISOString())
          .maybeSingle();
        isPaidPro = Boolean(activeSubscription);
      }
    }

    const retentionDays = isPaidPro ? 30 : 14;
    const expiresAt = Math.floor(Date.now() / 1000) + (retentionDays * 24 * 60 * 60);

    await this.ingestion.processDocument(
      job.document_id,
      chunks,
      ownerId,
      expiresAt,
    );
  }
}
