import { SupabaseClient } from '@supabase/supabase-js';
import { IngestionService } from './ingestion';
import { logger, deterministicChunking } from './utils';
import { UploadJob } from './types';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';

export class RAGWorker {
  private isRunning = false;
  private pipelineId: string;
  private workerInstanceId: string;
  private pollIntervalMs: number;
  private leaseDurationMs: number;
  private leaseHeartbeatMs: number;
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(
    private supabase: SupabaseClient,
    private ingestion: IngestionService,
  ) {
    this.pipelineId = process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker';
    this.workerInstanceId =
      process.env.WORKER_INSTANCE_ID ||
      `${this.pipelineId}-${process.env.HOSTNAME || Math.random().toString(36).substring(7)}`;
    this.pollIntervalMs = this.parsePositiveInt(process.env.WORKER_POLL_INTERVAL_MS, 2000);
    this.leaseDurationMs = this.parsePositiveInt(process.env.WORKER_LEASE_MS, 300000);
    this.leaseHeartbeatMs = this.parsePositiveInt(process.env.WORKER_LEASE_HEARTBEAT_MS, 60000);
    this.chunkSize = this.parsePositiveInt(process.env.WORKER_CHUNK_SIZE, 1000);
    const parsedOverlap = this.parsePositiveInt(process.env.WORKER_CHUNK_OVERLAP, 200);
    this.chunkOverlap = Math.min(parsedOverlap, Math.max(0, this.chunkSize - 1));
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async logDebug(message: string, details: Record<string, unknown>) {
    try {
      await this.supabase.from('au_debug_logs').insert({
        component: 'rag-worker',
        message,
        details,
      });
    } catch {
      // Debug logging should never break the ingestion loop.
    }
  }

  private async updateJobProgress(jobId: string, progress: number) {
    const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      progress: clamped,
      updated_at: nowIso,
      last_progress_at: nowIso,
    };
    const error = await this.updateJobRow(jobId, payload, ['last_progress_at']);
    if (error) {
      logger.warn('Failed to update job progress', { jobId, message: error.message });
    }
  }

  private beginLeaseHeartbeat(jobId: string): () => void {
    const intervalMs = Math.max(10000, this.leaseHeartbeatMs);
    const timer = setInterval(async () => {
      try {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + this.leaseDurationMs).toISOString();
        const payload: Record<string, unknown> = {
          locked_at: now.toISOString(),
          locked_until: leaseUntil,
          claimed_by: this.workerInstanceId,
          updated_at: now.toISOString(),
          last_heartbeat_at: now.toISOString(),
        };
        const error = await this.updateJobRow(
          jobId,
          payload,
          ['last_heartbeat_at'],
          (query) => query.eq('status', 'processing'),
        );
        if (error) {
          logger.warn('Failed to renew worker lease', { jobId, message: error.message });
        }
      } catch (error) {
        logger.warn('Lease heartbeat threw an exception', {
          jobId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }

  private async updateCleanupState(
    documentId: string,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    let attempts = 1;

    try {
      const { data } = await this.supabase
        .from('au_documents')
        .select('cleanup_attempts')
        .eq('id', documentId)
        .maybeSingle();
      attempts = Number(data?.cleanup_attempts || 0) + 1;
    } catch {
      attempts = 1;
    }

    const payload = success
      ? {
        storage_deleted_at: now,
        cleanup_pending: false,
        cleanup_attempts: attempts,
        cleanup_last_error: null,
        cleanup_last_attempt_at: now,
      }
      : {
        cleanup_pending: true,
        cleanup_attempts: attempts,
        cleanup_last_error: errorMessage || 'unknown_error',
        cleanup_last_attempt_at: now,
      };

    await this.supabase
      .from('au_documents')
      .update(payload)
      .eq('id', documentId);
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const legacyDefault = (pdfParseModule as any)?.default;
    if (typeof legacyDefault === 'function') {
      const parsed = await legacyDefault(buffer);
      return typeof parsed?.text === 'string' ? parsed.text : '';
    }

    const PDFParseCtor = (pdfParseModule as any)?.PDFParse;
    if (typeof PDFParseCtor === 'function') {
      const parser = new PDFParseCtor({ data: new Uint8Array(buffer) });
      try {
        const parsed = await parser.getText();
        return typeof parsed?.text === 'string' ? parsed.text : '';
      } finally {
        if (typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      }
    }

    throw new Error('Unsupported pdf-parse module export');
  }

  async start() {
    this.isRunning = true;
    logger.info('Worker started', { pipelineId: this.pipelineId, workerId: this.workerInstanceId });
    await this.ingestion.ensureStartupIndexes();

    while (this.isRunning) {
      try {
        await Promise.all([
          this.pollJobs(),
          this.pollDeletions(),
          this.reconcileStuckJobs(),
        ]);
        await this.wait(this.pollIntervalMs);
      } catch (err) {
        logger.error('Worker loop error', err);
        await this.wait(Math.max(this.pollIntervalMs * 2, 5000));
      }
    }
  }

  private async reconcileStuckJobs() {
    try {
      // 1. Fix "Analyzing 100%" stuck jobs (1 minute grace period)
      const stuckThreshold = new Date(Date.now() - 60000).toISOString();
      const { data: stuckCompleted } = await this.supabase
        .from('au_worker_jobs')
        .select('id, document_id, bucket, object_path, owner_id, user_id')
        .eq('status', 'processing')
        .eq('progress', 100)
        .lt('updated_at', stuckThreshold)
        .limit(5);

      if (stuckCompleted && stuckCompleted.length > 0) {
        for (const job of stuckCompleted) {
          logger.info('Reconciling stuck 100% job', { jobId: job.id });
          await this.finalizeJobCompletion(job as UploadJob);
        }
      }

      // 2. Fix stale processing jobs (15 mins timeout)
      const staleThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: staleJobs } = await this.supabase
        .from('au_worker_jobs')
        .select('id, document_id, bucket, object_path, owner_id, user_id')
        .eq('status', 'processing')
        .lt('updated_at', staleThreshold)
        .limit(5);

      if (staleJobs && staleJobs.length > 0) {
        for (const job of staleJobs) {
          logger.warn('Reconciling stale processing job', { jobId: job.id });
          await this.markJobFailed(job as UploadJob, 'Job timed out (stale)', { recoverable: true });
        }
      }
    } catch (err) {
      logger.error('Error in reconcileStuckJobs', err);
    }
  }

  private async finalizeJobCompletion(job: UploadJob) {
    let completionError = await this.markJobCompleted(job);
    if (completionError) {
      logger.warn('Job completion update failed, retrying...', { jobId: job.id, message: completionError.message });
      await this.wait(1000);
      completionError = await this.markJobCompleted(job);
    }

    if (completionError) {
      logger.error('CRITICAL: Job finished but status update failed', { jobId: job.id, message: completionError.message });
    } else {
      await this.incrementUsageCounters(String(job.owner_id || job.user_id || ''), {
        jobs_completed: 1,
      });

      logger.info('Job completed', { jobId: job.id });
      await this.logDebug('Job completed', { jobId: job.id });
    }

    try {
      await this.supabase
        .from('au_documents')
        .update({
          cleanup_pending: true,
          cleanup_attempts: 0,
          cleanup_last_error: null,
          cleanup_last_attempt_at: new Date().toISOString(),
        })
        .eq('id', job.document_id);

      const bucket = job.bucket || 'documents';
      logger.info('Deleting file from Supabase Storage', { bucket, path: job.object_path });
      const { error: deleteError } = await this.supabase.storage
        .from(bucket)
        .remove([job.object_path]);

      if (deleteError) {
        logger.error('Failed to delete file from storage', deleteError);
        await this.updateCleanupState(
          job.document_id,
          false,
          deleteError.message || String(deleteError),
        );
      } else {
        logger.info('File deleted successfully');
        await this.updateCleanupState(job.document_id, true);
      }
    } catch (delErr) {
      logger.error('Failed to delete file (exception)', delErr);
      const msg = delErr instanceof Error ? delErr.message : String(delErr);
      await this.updateCleanupState(job.document_id, false, msg);
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

  private async updateJobRow(
    jobId: string,
    payload: Record<string, unknown>,
    fallbackColumns: string[] = [],
    applyFilter?: (query: any) => any,
  ): Promise<Error | null> {
    let query = this.supabase
      .from('au_worker_jobs')
      .update(payload)
      .eq('id', jobId);
    if (applyFilter) {
      query = applyFilter(query);
    }
    const { error } = await query;
    if (!error) return null;

    const missingColumns = fallbackColumns.filter((column) => this.isMissingColumnError(error, column));
    if (missingColumns.length === 0) {
      return error;
    }

    const nextPayload = { ...payload };
    for (const column of missingColumns) {
      delete (nextPayload as any)[column];
    }

    let retryQuery = this.supabase
      .from('au_worker_jobs')
      .update(nextPayload)
      .eq('id', jobId);
    if (applyFilter) {
      retryQuery = applyFilter(retryQuery);
    }
    const { error: retryError } = await retryQuery;
    return retryError ?? null;
  }

  private async markJobCompleted(job: UploadJob): Promise<Error | null> {
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      status: 'completed',
      progress: 100,
      locked_at: null,
      locked_until: null,
      updated_at: nowIso,
      completed_at: nowIso,
      last_progress_at: nowIso,
    };
    return await this.updateJobRow(job.id, payload, ['completed_at', 'last_progress_at']);
  }

  private async findFallbackCandidate(): Promise<any | null> {
    const workerFilter = `worker_id.eq.${this.pipelineId},worker_id.is.null`;

    const { data: queuedCandidate, error: queuedError } = await this.supabase
      .from('au_worker_jobs')
      .select('*')
      .in('status', ['queued', 'uploaded'])
      .or(workerFilter)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (queuedError) throw queuedError;
    if (queuedCandidate) return queuedCandidate;

    const nowIso = new Date().toISOString();
    const staleBase = this.supabase
      .from('au_worker_jobs')
      .select('*')
      .eq('status', 'processing')
      .or(workerFilter)
      .lt('locked_until', nowIso)
      .order('updated_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const { data: staleCandidate, error: staleError } = await staleBase;

    if (staleError) throw staleError;
    if (staleCandidate) return staleCandidate;

    const { data: unlockedCandidate, error: unlockedError } = await this.supabase
      .from('au_worker_jobs')
      .select('*')
      .eq('status', 'processing')
      .or(workerFilter)
      .is('locked_until', null)
      .order('updated_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (unlockedError) throw unlockedError;
    return unlockedCandidate || null;
  }

  private async claimJob(): Promise<UploadJob | null> {
    // Preferred path: atomic DB function.
    const { data: rpcJobs, error: rpcError } = await this.supabase.rpc('claim_worker_job', {
      p_worker_id: this.workerInstanceId,
      p_lease_duration_ms: this.leaseDurationMs,
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
    const candidate = await this.findFallbackCandidate();
    if (!candidate) {
      return null;
    }

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + this.leaseDurationMs).toISOString();
    let claimQuery = this.supabase
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
      .in('status', candidate.status === 'processing' ? ['processing'] : ['queued', 'uploaded']);

    if (candidate.status === 'processing') {
      if (candidate.locked_until) {
        claimQuery = claimQuery.eq('locked_until', candidate.locked_until);
      } else {
        claimQuery = claimQuery.is('locked_until', null);
      }
    }

    const { data: claimed, error: claimError } = await claimQuery.select('*').maybeSingle();

    if (claimError) {
      throw claimError;
    }
    if (!claimed) {
      return null;
    }

    return this.normalizeClaimedJob(claimed);
  }

  private async markJobFailed(
    job: UploadJob,
    errorMessage: string,
    options?: { recoverable?: boolean; recoverableReason?: string },
  ) {
    const retryCount = Number((job as any)?.retry_count || 0);
    const shouldMarkRecoverable = Boolean(options?.recoverable) && retryCount <= 0;
    const metadataBase =
      job?.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? { ...(job.metadata as Record<string, unknown>) }
        : {};

    if (shouldMarkRecoverable) {
      metadataBase.recoverable = true;
      metadataBase.recoverable_reason = options?.recoverableReason || 'transient_worker_error';
      metadataBase.recoverable_at = new Date().toISOString();
    }

    const payload = {
      status: 'failed',
      error: errorMessage,
      locked_at: null,
      locked_until: null,
      updated_at: new Date().toISOString(),
      ...(shouldMarkRecoverable ? { metadata: metadataBase } : {}),
    };

    const { error } = await this.supabase
      .from('au_worker_jobs')
      .update(payload)
      .eq('id', job.id);

    if (error && this.isMissingColumnError(error, 'error')) {
      const fallbackPayload: Record<string, unknown> = {
        status: 'failed',
        updated_at: new Date().toISOString(),
      };
      if (shouldMarkRecoverable && !this.isMissingColumnError(error, 'metadata')) {
        fallbackPayload.metadata = metadataBase;
      }

      await this.supabase
        .from('au_worker_jobs')
        .update(fallbackPayload)
        .eq('id', job.id);
      return;
    }

    if (error) {
      logger.error('Failed to mark job as failed', { jobId: job.id, error: error.message });
    }
  }

  private async markDocumentFailed(documentId: string, errorMessage: string) {
    const updateResult = await this.supabase
      .from('au_documents')
      .update({
        status: 'failed',
        error: errorMessage,
      })
      .eq('id', documentId);

    if (updateResult.error) {
      logger.warn('Failed to mark document as failed', {
        documentId,
        message: updateResult.error.message,
      });
    }
  }

  private async incrementUsageCounters(ownerId: string, increments: Record<string, number>): Promise<void> {
    const normalizedOwnerId = String(ownerId || '').trim();
    if (!normalizedOwnerId) return;

    try {
      const payload = Object.entries(increments).reduce((acc, [key, value]) => {
        if (!Number.isFinite(value)) return acc;
        acc[key] = value;
        return acc;
      }, {} as Record<string, number>);

      if (Object.keys(payload).length === 0) return;

      const { error } = await this.supabase.rpc('increment_usage_counters', {
        p_user_id: normalizedOwnerId,
        p_increments: payload,
        p_day: new Date().toISOString().slice(0, 10),
      });
      if (error) {
        logger.warn('Failed to increment usage counters from worker', {
          ownerId: normalizedOwnerId,
          message: error.message,
          increments: payload,
        });
      }
    } catch (error) {
      logger.warn('Usage counter increment threw in worker', {
        ownerId: normalizedOwnerId,
        increments,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async pollDeletions() {
    const bucket = process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';
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
        await this.ingestion.deleteDocument(log.document_id, log.owner_id || undefined);

        if (log.file_path) {
          const { error: storageError } = await this.supabase.storage
            .from(bucket)
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

    await this.logDebug('Job claimed', {
      jobId: currentJob.id,
      workerId: this.workerInstanceId,
      pipelineId: this.pipelineId,
    });

    const stopHeartbeat = this.beginLeaseHeartbeat(currentJob.id);

    try {
      await this.updateJobProgress(currentJob.id, 15);
      await this.processJob(currentJob);

      // Critical fix: Combine final progress update and completion state
      // Do not update to 100% separately to avoid "stuck at 100% analyzing" state
      // if the subsequent completion update fails.
      await this.finalizeJobCompletion(currentJob);
    } catch (processErr) {
      logger.error('Job failed', { jobId: currentJob.id, error: processErr });

      const errorMessage = processErr instanceof Error ? processErr.message : String(processErr);
      const isRecoverable = Boolean((processErr as any)?.recoverable);
      const recoverableReason = isRecoverable ? 'fastembed_cache_corruption' : undefined;

      await this.logDebug('Job failed', {
        jobId: currentJob.id,
        error: errorMessage,
        stack: processErr instanceof Error ? processErr.stack : null,
        recoverable: isRecoverable,
        recoverableReason,
      });

      await this.markJobFailed(currentJob, errorMessage, {
        recoverable: isRecoverable,
        recoverableReason,
      });
      await this.markDocumentFailed(currentJob.document_id, errorMessage);
      await this.incrementUsageCounters(String(currentJob.owner_id || currentJob.user_id || ''), {
        jobs_failed: 1,
      });
    } finally {
      stopHeartbeat();
    }
  }

  private async processJob(job: UploadJob) {
    const jobStartedAt = Date.now();
    const ownerId = String(job.owner_id || job.user_id || '').trim();
    if (!ownerId) {
      throw new Error('Missing owner_id/user_id for job processing.');
    }

    await this.updateJobProgress(job.id, 20);

    logger.info('Downloading file', { bucket: job.bucket, path: job.object_path });
    const downloadStartedAt = Date.now();
    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from(job.bucket)
      .download(job.object_path);

    if (downloadError) throw downloadError;

    let text = '';
    const buffer = Buffer.from(await fileData.arrayBuffer());
    const extension = job.object_path.split('.').pop()?.toLowerCase();

    if (extension === 'pdf') {
      text = await this.extractPdfText(buffer);
    } else if (extension === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      text = buffer.toString('utf-8');
    }

    const extractDurationMs = Date.now() - downloadStartedAt;
    await this.updateJobProgress(job.id, 40);

    if (!text || text.trim().length === 0) {
      throw new Error('No text content extracted from document');
    }

    const chunkStartedAt = Date.now();
    const chunks = deterministicChunking(text, this.chunkSize, this.chunkOverlap);
    const chunkDurationMs = Date.now() - chunkStartedAt;
    await this.updateJobProgress(job.id, 55);
    if (chunks.length === 0) {
      throw new Error('Chunking produced no usable chunks');
    }

    const { data: currentDoc } = await this.supabase
      .from('au_documents')
      .select('document_type,parent_id,expires_at')
      .eq('id', job.document_id)
      .maybeSingle();

    // Retention policy:
    // - Past questions / exam questions inherit their parent textbook expiry.
    // - Otherwise:
    //   - Billing disabled (promo mode): 14 days for everyone
    //   - Billing enabled + paid pro: 30 days
    //   - Otherwise: 14 days
    const now = new Date();
    const [{ data: profile }, { data: billingFlag }, { data: conexConfig }, { data: legacyConfig }] = await Promise.all([
      this.supabase
        .from('au_user_profiles')
        .select('tier,tier_expires_at')
        .eq('user_id', ownerId)
        .maybeSingle(),
      this.supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'billing_enabled')
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

    const billingEnabled =
      (typeof billingFlag?.enabled === 'boolean' ? billingFlag.enabled : null) ??
      conexConfig?.billing_enabled ??
      legacyConfig?.billing_enabled ??
      true;
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

    const normalizedDocType = String((currentDoc as any)?.document_type || '').toLowerCase();
    const parentId = String((currentDoc as any)?.parent_id || '').trim();
    let inheritedParentExpiryMs: number | null = null;
    if ((normalizedDocType === 'past_questions' || normalizedDocType === 'exam_questions') && parentId) {
      const { data: parentDoc } = await this.supabase
        .from('au_documents')
        .select('expires_at')
        .eq('id', parentId)
        .maybeSingle();
      const parentExpiryRaw = String((parentDoc as any)?.expires_at || '').trim();
      const parentExpiryMs = parentExpiryRaw ? new Date(parentExpiryRaw).getTime() : Number.NaN;
      if (Number.isFinite(parentExpiryMs)) {
        inheritedParentExpiryMs = parentExpiryMs;
      }
    }

    const retentionDays = isPaidPro ? 30 : 14;
    const expiresAt = inheritedParentExpiryMs
      ? Math.floor(inheritedParentExpiryMs / 1000)
      : Math.floor(Date.now() / 1000) + (retentionDays * 24 * 60 * 60);
    const expirySource = inheritedParentExpiryMs ? 'parent_textbook' : 'policy';

    await this.updateJobProgress(job.id, 70);
    await this.ingestion.processDocument(
      job.document_id,
      chunks,
      ownerId,
      expiresAt,
    );

    await this.updateJobProgress(job.id, 95);
    logger.info('Job processing metrics', {
      jobId: job.id,
      documentId: job.document_id,
      ownerId,
      chunkCount: chunks.length,
      extractionMs: extractDurationMs,
      chunkingMs: chunkDurationMs,
      totalMs: Date.now() - jobStartedAt,
      retentionDays,
      expirySource,
    });
  }
}
