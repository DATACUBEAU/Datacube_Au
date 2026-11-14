import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { assertWorkerLeaseOwnership, WorkerLeaseLostError } from './worker-lease';
import { IngestionService } from './ingestion';
import { logger, deterministicChunking, alnumRatio, zeroRatio } from './utils';
import { UploadJob } from './types';
import { finalizeDocumentSourceCleanup, markDocumentCleanupPending } from './source-cleanup';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';

function normalizeJobErrorMessage(error: unknown): string {
  const candidateStrings: string[] = [];

  if (typeof error === 'string') {
    candidateStrings.push(error);
  }

  if (error instanceof Error) {
    candidateStrings.push(error.message, error.name, String(error));
  } else if (error && typeof error === 'object') {
    const anyError = error as any;
    if (typeof anyError.message === 'string') candidateStrings.push(anyError.message);
    if (typeof anyError.error === 'string') candidateStrings.push(anyError.error);
    if (typeof anyError.details === 'string') candidateStrings.push(anyError.details);
    if (typeof anyError.hint === 'string') candidateStrings.push(anyError.hint);
  }

  for (const raw of candidateStrings) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    if (trimmed === '{}' || trimmed === '[]' || trimmed === '[object Object]') continue;
    return trimmed;
  }

  try {
    const json = JSON.stringify(error);
    const trimmed = typeof json === 'string' ? json.trim() : '';
    if (trimmed && trimmed !== '{}' && trimmed !== '[]') {
      return trimmed;
    }
  } catch {
    // ignore JSON stringify errors
  }

  const fallback = String(error || '').trim();
  if (fallback && fallback !== '{}' && fallback !== '[object Object]') {
    return fallback;
  }

  return 'Unknown worker error';
}

function createRecoverableJobError(message: string, reason: string): Error {
  const error = new Error(message);
  (error as any).recoverable = true;
  (error as any).recoverableReason = reason;
  return error;
}

function assertValidExtractedText(text: string, extension: string | undefined) {
  const trimmed = text.trim();
  const len = trimmed.length;
  if (len < 500) {
    if (extension === 'pdf') {
      throw new Error('ocr_required: PDF content is too short, OCR may be required');
    }
    throw new Error(`extract_too_short: Text content is too short (${len} chars)`);
  }

  const alnum = alnumRatio(trimmed);
  if (alnum < 0.15) {
    throw new Error(`extract_nontext: Low alphanumeric content (${alnum.toFixed(2)})`);
  }

  const zeros = zeroRatio(trimmed);
  if (zeros > 0.30) {
    throw new Error(`extract_placeholder_zeros: High zero content (${zeros.toFixed(2)})`);
  }
}

export class RAGWorker {
  private isRunning = false;
  private pipelineId: string;
  private workerInstanceId: string;
  private pollIntervalMs: number;
  private leaseDurationMs: number;
  private leaseHeartbeatMs: number;
  private chunkSize: number;
  private chunkOverlap: number;
  private lastTerminalClaimReconcileAt = 0;
  private completionAttemptTokens = new Map<string, string>();
  private failureAttemptTokens = new Map<string, string>();

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

  private async updateClaimedJobRow(
    jobId: string,
    payload: Record<string, unknown>,
    fallbackColumns: string[] = [],
  ): Promise<{ updated: boolean; error: any | null }> {
    const executeUpdate = async (nextPayload: Record<string, unknown>) =>
      await this.supabase
        .from('au_worker_jobs')
        .update(nextPayload)
        .eq('id', jobId)
        .eq('status', 'processing')
        .eq('claimed_by', this.workerInstanceId)
        .select('id')
        .maybeSingle();

    let { data, error } = await executeUpdate(payload);
    if (error) {
      const missingColumns = fallbackColumns.filter((column) => this.isMissingColumnError(error, column));
      if (missingColumns.length === 0) return { updated: false, error };
      const fallbackPayload = { ...payload };
      for (const column of missingColumns) delete (fallbackPayload as any)[column];
      ({ data, error } = await executeUpdate(fallbackPayload));
    }
    return { updated: Boolean(data?.id), error: error ?? null };
  }

  private assertLeaseOwnership(jobId: string): Promise<void> {
    return assertWorkerLeaseOwnership(this.supabase, jobId, this.workerInstanceId);
  }

  private async reconcileTerminalAttemptMarker(
    jobId: string,
    expectedStatus: 'completed' | 'failed',
    markerKey: 'worker_completion_attempt' | 'worker_failure_attempt',
    token: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('au_worker_jobs')
      .select('id,status,claimed_by,metadata')
      .eq('id', jobId)
      .maybeSingle();
    if (error || !data) return false;

    const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : {};
    if (data.status === expectedStatus && metadata[markerKey] === token) return true;
    if (data.status !== 'processing' || data.claimed_by !== this.workerInstanceId) {
      throw new WorkerLeaseLostError(jobId);
    }
    return false;
  }

  private async updateJobProgress(jobId: string, progress: number) {
    const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
    const nowIso = new Date().toISOString();
    const result = await this.updateClaimedJobRow(
      jobId,
      { progress: clamped, updated_at: nowIso, last_progress_at: nowIso },
      ['last_progress_at'],
    );
    if (result.error) {
      logger.warn('Failed to update job progress', { jobId, message: result.error.message });
      return;
    }
    if (!result.updated) throw new WorkerLeaseLostError(jobId);
  }

  private beginLeaseHeartbeat(jobId: string): () => void {
    const intervalMs = Math.max(10000, this.leaseHeartbeatMs);
    let timer: ReturnType<typeof setInterval>;
    timer = setInterval(async () => {
      try {
        const now = new Date();
        const result = await this.updateClaimedJobRow(
          jobId,
          {
            locked_at: now.toISOString(),
            locked_until: new Date(now.getTime() + this.leaseDurationMs).toISOString(),
            updated_at: now.toISOString(),
            last_heartbeat_at: now.toISOString(),
          },
          ['last_heartbeat_at'],
        );
        if (result.error) {
          logger.warn('Failed to renew worker lease', { jobId, message: result.error.message });
        } else if (!result.updated) {
          logger.warn('Stopped lease heartbeat after durable ownership changed', {
            jobId,
            workerId: this.workerInstanceId,
          });
          clearInterval(timer);
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
      await this.reconcileTerminalJobClaims();

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
          await this.finalizeDocumentIngestion(job as UploadJob);
        }
      }

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

  private async reconcileTerminalJobClaims() {
    const intervalMs = Math.max(
      30000,
      this.parsePositiveInt(process.env.WORKER_TERMINAL_CLAIM_RECONCILE_MS, 60000),
    );

    const nowMs = Date.now();
    if (nowMs - this.lastTerminalClaimReconcileAt < intervalMs) return;
    this.lastTerminalClaimReconcileAt = nowMs;

    try {
      const { data, error } = await this.supabase
        .from('au_worker_jobs')
        .select('id')
        .in('status', ['failed', 'completed'])
        .not('claimed_by', 'is', null)
        .limit(50);

      if (error) {
        logger.warn('Failed to scan for terminal jobs with stale claims', { message: error.message });
        return;
      }

      const ids = (data || []).map((row: any) => String(row?.id || '').trim()).filter(Boolean);
      if (ids.length === 0) return;

      const nowIso = new Date().toISOString();
      const { error: updateError } = await this.supabase
        .from('au_worker_jobs')
        .update({
          claimed_by: null,
          locked_at: null,
          locked_until: null,
          updated_at: nowIso,
        })
        .in('id', ids);

      if (updateError) {
        logger.warn('Failed to reconcile terminal job claims', { message: updateError.message, count: ids.length });
        return;
      }

      logger.info('Reconciled terminal jobs with stale claims', { count: ids.length });
    } catch (err) {
      logger.warn('Terminal job claim reconciliation threw', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async finalizeDocumentIngestion(job: UploadJob) {
    let completion = await this.markJobCompleted(job);
    if (completion.error) {
      logger.warn('Job completion update failed; retrying once', {
        jobId: job.id,
        message: completion.error.message,
      });
      await this.wait(1000);
      completion = await this.markJobCompleted(job);
    }

    if (completion.error) {
      logger.error('Job processing finished but durable completion did not persist', {
        jobId: job.id,
        message: completion.error.message,
      });
      return;
    }
    if (!completion.updated) throw new WorkerLeaseLostError(job.id);

    await this.incrementUsageCounters(String(job.owner_id || job.user_id || ''), {
      jobs_completed: 1,
    });
    this.completionAttemptTokens.delete(job.id);

    logger.info('Job completed', { jobId: job.id });
    await this.logDebug('Job completed', { jobId: job.id });

    try {
      await markDocumentCleanupPending({
        supabase: this.supabase,
        documentId: job.document_id,
      });

      const cleanupResult = await finalizeDocumentSourceCleanup({
        supabase: this.supabase,
        documentId: job.document_id,
        preferredBucket: String(job.bucket || '').trim() || null,
        preferredObjectPath: String(job.object_path || '').trim() || null,
        expectedOwnerId: String(job.owner_id || job.user_id || '').trim() || null,
        defaultBucket: process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents',
      });

      if (!cleanupResult.success) {
        logger.error('Failed to finalize document source cleanup', {
          jobId: job.id,
          documentId: job.document_id,
          bucket: cleanupResult.bucket,
          cleanupCode: cleanupResult.code,
          cleanupError: cleanupResult.error,
          cleanupAttempts: cleanupResult.attempts,
        });
      } else {
        logger.info('Document source cleanup completed', {
          jobId: job.id,
          documentId: job.document_id,
          bucket: cleanupResult.bucket,
          cleanupCode: cleanupResult.code,
          cleanupAttempts: cleanupResult.attempts,
          sourceDeletedAt: cleanupResult.deletedAt,
        });
      }
    } catch (cleanupError) {
      logger.error('Failed to finalize document source cleanup (exception)', cleanupError);
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
    if (applyFilter) query = applyFilter(query);
    const { error } = await query;
    if (!error) return null;

    const missingColumns = fallbackColumns.filter((column) => this.isMissingColumnError(error, column));
    if (missingColumns.length === 0) return error;

    const nextPayload = { ...payload };
    for (const column of missingColumns) delete (nextPayload as any)[column];
    let retryQuery = this.supabase
      .from('au_worker_jobs')
      .update(nextPayload)
      .eq('id', jobId);
    if (applyFilter) retryQuery = applyFilter(retryQuery);
    const { error: retryError } = await retryQuery;
    return retryError ?? null;
  }

  private async markJobCompleted(job: UploadJob): Promise<{ updated: boolean; error: Error | null }> {
    const nowIso = new Date().toISOString();
    const token = this.completionAttemptTokens.get(job.id) || randomUUID();
    this.completionAttemptTokens.set(job.id, token);
    const previousMetadata =
      job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? { ...(job.metadata as Record<string, unknown>) }
        : {};
    const payload: Record<string, unknown> = {
      status: 'completed',
      progress: 100,
      error: null,
      claimed_by: null,
      locked_at: null,
      locked_until: null,
      updated_at: nowIso,
      completed_at: nowIso,
      last_progress_at: nowIso,
      metadata: { ...previousMetadata, worker_completion_attempt: token },
    };

    const result = await this.updateClaimedJobRow(
      job.id,
      payload,
      ['completed_at', 'last_progress_at', 'error'],
    );
    if (result.error) {
      try {
        if (await this.reconcileTerminalAttemptMarker(job.id, 'completed', 'worker_completion_attempt', token)) {
          return { updated: true, error: null };
        }
      } catch (ownershipError) {
        if (ownershipError instanceof WorkerLeaseLostError) throw ownershipError;
      }
      return { updated: false, error: result.error as Error };
    }
    return { updated: result.updated, error: null };
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
  ): Promise<
    | { outcome: 'updated' }
    | { outcome: 'ownership_lost' }
    | { outcome: 'error'; message: string }
  > {
    const retryCount = Number((job as any)?.retry_count || 0);
    const shouldMarkRecoverable = Boolean(options?.recoverable) && retryCount <= 0;
    const previousMetadata =
      job?.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? { ...(job.metadata as Record<string, unknown>) }
        : {};
    const token = this.failureAttemptTokens.get(job.id) || randomUUID();
    this.failureAttemptTokens.set(job.id, token);
    const payload: Record<string, unknown> = {
      status: 'failed',
      error: String(errorMessage || '').trim(),
      claimed_by: null,
      locked_at: null,
      locked_until: null,
      updated_at: new Date().toISOString(),
      metadata: {
        ...previousMetadata,
        worker_failure_attempt: token,
        ...(shouldMarkRecoverable ? {
          recoverable: true,
          recoverable_reason: options?.recoverableReason || 'transient_worker_error',
          recoverable_at: new Date().toISOString(),
        } : {}),
      },
    };

    const result = await this.updateClaimedJobRow(job.id, payload, ['error']);
    if (result.error) {
      try {
        if (await this.reconcileTerminalAttemptMarker(job.id, 'failed', 'worker_failure_attempt', token)) {
          this.failureAttemptTokens.delete(job.id);
          return { outcome: 'updated' };
        }
      } catch (ownershipError) {
        if (ownershipError instanceof WorkerLeaseLostError) return { outcome: 'ownership_lost' };
      }
      return { outcome: 'error', message: result.error.message };
    }
    if (!result.updated) {
      this.failureAttemptTokens.delete(job.id);
      return { outcome: 'ownership_lost' };
    }
    this.failureAttemptTokens.delete(job.id);
    return { outcome: 'updated' };
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
      await this.finalizeDocumentIngestion(currentJob);
    } catch (processErr) {
      if (processErr instanceof WorkerLeaseLostError) {
        logger.warn('Stopped stale job attempt after lease ownership changed', {
          jobId: currentJob.id,
          documentId: currentJob.document_id,
          workerId: this.workerInstanceId,
        });
        await this.logDebug('Stopped stale job attempt after lease ownership changed', {
          jobId: currentJob.id,
          documentId: currentJob.document_id,
          workerId: this.workerInstanceId,
        });
        return;
      }

      logger.error('Job failed', { jobId: currentJob.id, error: processErr });
      const errorMessage = normalizeJobErrorMessage(processErr);
      const isRecoverable = Boolean((processErr as any)?.recoverable);
      const recoverableReason = isRecoverable
        ? String((processErr as any)?.recoverableReason || 'transient_worker_error')
        : undefined;
      await this.logDebug('Job failed', {
        jobId: currentJob.id,
        error: errorMessage,
        stack: processErr instanceof Error ? processErr.stack : null,
        recoverable: isRecoverable,
        recoverableReason,
      });

      const failureMutation = await this.markJobFailed(currentJob, errorMessage, {
        recoverable: isRecoverable,
        recoverableReason,
      });
      if (failureMutation.outcome !== 'updated') {
        logger.warn('Skipped document failure and failure usage because claimed failure mutation did not persist', {
          jobId: currentJob.id,
          documentId: currentJob.document_id,
          ...failureMutation,
        });
        return;
      }

      await this.markDocumentFailed(currentJob.document_id, errorMessage);
      await this.incrementUsageCounters(String(currentJob.owner_id || currentJob.user_id || ''), {
        jobs_failed: 1,
      });
    } finally {
      stopHeartbeat();
    }
  }

  private async processJob(job: UploadJob) {    } finally {
      stopHeartbeat();
    }
  }

  private async processJob(job: UploadJob) {
    const jobStartedAt = Date.now();
    const assertLeaseOwnership = () => this.assertLeaseOwnership(job.id);
    await assertLeaseOwnership();
    const ownerId = String(job.owner_id || job.user_id || '').trim();
    if (!ownerId) {
      throw new Error('Missing owner_id/user_id for job processing.');
    }

    await this.updateJobProgress(job.id, 20);

    logger.info('Downloading file', { jobId: job.id, documentId: job.document_id, bucket: job.bucket });
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

    this.logDebug('Extracted text stats', {
      jobId: job.id,
      documentId: job.document_id,
      textLength: text.length,
      alnumRatio: alnumRatio(text),
      zeroRatio: zeroRatio(text),
    });

    assertValidExtractedText(text, extension);

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

    let retentionDays: number | null = null;
    let effectivePlan: string | null = null;
    let entitlementSource: string | null = null;

    if (!inheritedParentExpiryMs) {
      const { data: effectiveEntitlements, error: entitlementError } = await this.supabase.rpc(
        'get_effective_entitlements',
        { p_user_id: ownerId },
      );

      if (entitlementError) {
        throw createRecoverableJobError(
          `entitlement_resolution_failed: ${String(entitlementError.message || 'authoritative entitlement lookup failed')}`,
          'entitlement_resolution_failed',
        );
      }

      const entitlementRow = Array.isArray(effectiveEntitlements)
        ? effectiveEntitlements[0]
        : effectiveEntitlements;
      const rawRetentionDays = Number(
        (entitlementRow as any)?.retention_days ?? (entitlementRow as any)?.retentionDays,
      );

      if (!Number.isFinite(rawRetentionDays) || rawRetentionDays <= 0) {
        throw createRecoverableJobError(
          'entitlement_resolution_invalid: authoritative entitlement response did not include a valid retention_days value',
          'entitlement_resolution_invalid',
        );
      }

      retentionDays = Math.max(1, Math.floor(rawRetentionDays));
      effectivePlan = String((entitlementRow as any)?.plan || '').trim().toLowerCase() || 'unknown';
      entitlementSource = String(
        (entitlementRow as any)?.entitlement_source ?? (entitlementRow as any)?.entitlementSource ?? '',
      ).trim().toLowerCase() || 'unknown';
    }

    const expiresAt = inheritedParentExpiryMs
      ? Math.floor(inheritedParentExpiryMs / 1000)
      : Math.floor(Date.now() / 1000) + ((retentionDays as number) * 24 * 60 * 60);
    const expirySource = inheritedParentExpiryMs ? 'parent_textbook' : 'effective_entitlements';

    await this.updateJobProgress(job.id, 70);
    await this.ingestion.processDocument(
      job.document_id,
      chunks,
      ownerId,
      expiresAt,
      assertLeaseOwnership,
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
      effectivePlan,
      entitlementSource,
      expirySource,
    });
  }

  async reprocessDocument(documentId: string): Promise<void> {
    const { data: doc, error: docError } = await this.supabase
      .from('au_documents')
      .select('id,storage_deleted_at,source_deleted_at')
      .eq('id', documentId)
      .maybeSingle();

    if (docError) {
      throw new Error(`Failed to inspect document ${documentId} before reprocessing: ${docError.message}`);
    }

    if (doc?.storage_deleted_at || doc?.source_deleted_at) {
      throw new Error('source_not_retained: Original file is no longer retained after successful processing. Re-upload is required to reprocess from source.');
    }

    const { data: job, error } = await this.supabase
      .from('au_worker_jobs')
      .select('id')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      throw new Error(`Failed to find job for document ${documentId}: ${error.message}`);
    }

    if (!job) {
      throw new Error(`No job found for document ${documentId}`);
    }

    await this.updateJobRow(job.id, {
      status: 'queued',
      progress: 0,
      error: null,
      claimed_by: null,
      locked_at: null,
      locked_until: null,
      updated_at: new Date().toISOString(),
    });

    logger.info('Job requeued for reprocessing', { jobId: job.id, documentId });
  }
}
