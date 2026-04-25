import { SupabaseClient } from '@supabase/supabase-js';
import { IngestionService } from './ingestion';
import { logger, deterministicChunking, computeHash } from './utils';
import { UploadJob } from './types';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';

type WorkerJobMutationClassification = 'schema_mismatch' | 'transient_db' | 'logic_error';

type WorkerJobMutationResult =
  | { ok: true; mode: 'full' | 'legacy_schema_fallback' }
  | {
      ok: false;
      classification: WorkerJobMutationClassification;
      message: string;
    };

type CompletionReconcileState = {
  attempts: number;
  nextAttemptAt: number;
  lastClassification: WorkerJobMutationClassification;
  lastMessage: string;
};

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
  private lastCompletionReconcileAt = 0;
  private canonicalBucket: string;
  private completionReconcileScanMs: number;
  private completionReconcileBaseMs: number;
  private completionReconcileMaxMs: number;
  private completionReconcileMaxAttempts: number;
  private completionReconcileState = new Map<string, CompletionReconcileState>();
  private suppressedCompletionReconcileUntil = new Map<string, number>();
  private warnedSchemaFallbacks = new Set<string>();

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
    this.canonicalBucket = String(
      process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents',
    ).trim() || 'documents';
    this.completionReconcileScanMs = Math.max(
      5000,
      this.parsePositiveInt(process.env.WORKER_COMPLETION_RECONCILE_MS, 15000),
    );
    this.completionReconcileBaseMs = Math.max(
      1000,
      this.parsePositiveInt(process.env.WORKER_COMPLETION_RECONCILE_BASE_MS, 5000),
    );
    this.completionReconcileMaxMs = Math.max(
      this.completionReconcileBaseMs,
      this.parsePositiveInt(process.env.WORKER_COMPLETION_RECONCILE_MAX_MS, 300000),
    );
    this.completionReconcileMaxAttempts = Math.max(
      1,
      this.parsePositiveInt(process.env.WORKER_COMPLETION_RECONCILE_MAX_ATTEMPTS, 6),
    );
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

  private normalizeBucketName(rawBucket: unknown, context: { jobId?: string; documentId?: string; source: string }): string {
    const candidate = String(rawBucket || '').trim() || this.canonicalBucket;
    if (candidate !== this.canonicalBucket) {
      logger.warn('Non-canonical storage bucket encountered; keeping recorded bucket for compatibility', {
        ...context,
        expectedBucket: this.canonicalBucket,
        actualBucket: candidate,
      });
    }
    return candidate;
  }

  private isSchemaCacheMissingColumnError(error: any, column: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    const combined = `${message} ${details}`;
    return (
      combined.includes(column.toLowerCase()) &&
      (combined.includes('schema cache') || combined.includes('could not find the') || combined.includes('not present in the schema cache'))
    );
  }

  private warnSchemaFallbackOnce(key: string, context: Record<string, unknown>) {
    if (this.warnedSchemaFallbacks.has(key)) return;
    this.warnedSchemaFallbacks.add(key);
    logger.warn('Worker job lifecycle schema mismatch detected; using compatibility fallback', context);
  }

  private classifyWorkerJobMutationError(
    error: any,
    lifecycleColumns: string[] = [],
  ): { classification: WorkerJobMutationClassification; message: string } {
    const message = normalizeJobErrorMessage(error);
    const combined = `${String(error?.message || '')} ${String(error?.details || '')} ${String(error?.hint || '')}`.toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    const status = Number(error?.statusCode || error?.status || 0);

    if (
      lifecycleColumns.some((column) =>
        this.isMissingColumnError(error, column) || this.isSchemaCacheMissingColumnError(error, column),
      ) ||
      combined.includes('schema cache') ||
      code === 'PGRST204'
    ) {
      return { classification: 'schema_mismatch', message };
    }

    if (
      status >= 500 ||
      ['08000', '08001', '08003', '08006', '40P01', '40001', '53300', '57P01'].includes(code) ||
      combined.includes('timeout') ||
      combined.includes('timed out') ||
      combined.includes('connection') ||
      combined.includes('temporar')
    ) {
      return { classification: 'transient_db', message };
    }

    return { classification: 'logic_error', message };
  }

  private async updateJobProgress(jobId: string, progress: number) {
    try {
      const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
      const nowIso = new Date().toISOString();
      const { error } = await this.supabase
        .from('au_worker_jobs')
        .update({
          progress: clamped,
          last_progress_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', jobId);

      if (!error) return;

      if (this.isMissingColumnError(error, 'last_progress_at') || this.isSchemaCacheMissingColumnError(error, 'last_progress_at')) {
        this.warnSchemaFallbackOnce('progress:last_progress_at', {
          jobId,
          column: 'last_progress_at',
          message: error.message,
        });

        const { error: fallbackError } = await this.supabase
          .from('au_worker_jobs')
          .update({
            progress: clamped,
            updated_at: nowIso,
          })
          .eq('id', jobId);

        if (!fallbackError) return;

        const classified = this.classifyWorkerJobMutationError(fallbackError, ['last_progress_at']);
        logger.warn('Failed to update worker job progress after schema fallback', {
          jobId,
          progress: clamped,
          classification: classified.classification,
          message: classified.message,
        });
        return;
      }

      const classified = this.classifyWorkerJobMutationError(error, ['last_progress_at']);
      logger.warn('Failed to update worker job progress', {
        jobId,
        progress: clamped,
        classification: classified.classification,
        message: classified.message,
      });
    } catch (error) {
      const classified = this.classifyWorkerJobMutationError(error, ['last_progress_at']);
      logger.warn('Worker job progress update threw', {
        jobId,
        progress,
        classification: classified.classification,
        message: classified.message,
      });
    }
  }

  private beginLeaseHeartbeat(jobId: string): () => void {
    const intervalMs = Math.max(10000, this.leaseHeartbeatMs);
    const timer = setInterval(async () => {
      try {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + this.leaseDurationMs).toISOString();
        const { error } = await this.supabase
          .from('au_worker_jobs')
          .update({
            locked_at: now.toISOString(),
            locked_until: leaseUntil,
            claimed_by: this.workerInstanceId,
            updated_at: now.toISOString(),
          })
          .eq('id', jobId)
          .eq('status', 'processing');
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
    input: {
      success: boolean;
      sourceCleanupResult: string;
      errorMessage?: string | null;
    },
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

    const payload = input.success
      ? {
        storage_deleted_at: now,
        source_deleted_at: now,
        source_cleanup_result: input.sourceCleanupResult,
        cleanup_pending: false,
        cleanup_attempts: attempts,
        cleanup_last_error: null,
        cleanup_last_attempt_at: now,
      }
      : {
        cleanup_pending: true,
        cleanup_attempts: attempts,
        cleanup_last_error: input.errorMessage || 'unknown_error',
        cleanup_last_attempt_at: now,
        source_cleanup_result: input.sourceCleanupResult,
      };

    await this.supabase
      .from('au_documents')
      .update(payload)
      .eq('id', documentId);
  }

  private isStorageMissingError(error: any): boolean {
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

  private async cleanupSourceFileAfterSuccess(job: UploadJob): Promise<void> {
    const bucket = this.normalizeBucketName(job.bucket, {
      jobId: job.id,
      documentId: job.document_id,
      source: 'worker-success-cleanup',
    });
    const objectPath = String(job.object_path || '').trim();

    if (!objectPath) {
      try {
        await this.updateCleanupState(job.document_id, {
          success: true,
          sourceCleanupResult: 'no_source',
        });
      } catch (error) {
        logger.warn('Completed ingestion but failed to persist no_source cleanup state', {
          jobId: job.id,
          documentId: job.document_id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info('Completed ingestion with no source file path recorded; skipping storage cleanup', {
        jobId: job.id,
        documentId: job.document_id,
      });
      return;
    }

    try {
      const { error } = await this.supabase.storage
        .from(bucket)
        .remove([objectPath]);

      if (error && !this.isStorageMissingError(error)) {
        const errorMessage = error.message || String(error);
        await this.updateCleanupState(job.document_id, {
          success: false,
          sourceCleanupResult: 'delete_failed',
          errorMessage,
        });
        logger.warn('Source file cleanup failed after successful processing; queued for retry', {
          jobId: job.id,
          documentId: job.document_id,
          bucket,
          objectPath,
          message: errorMessage,
        });
        return;
      }

      const cleanupResult = error ? 'missing' : 'deleted';
      await this.updateCleanupState(job.document_id, {
        success: true,
        sourceCleanupResult: cleanupResult,
      });
      logger.info('Source file cleanup completed after successful processing', {
        jobId: job.id,
        documentId: job.document_id,
        bucket,
        objectPath,
        cleanupResult,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        await this.updateCleanupState(job.document_id, {
          success: false,
          sourceCleanupResult: 'delete_failed',
          errorMessage,
        });
      } catch (stateError) {
        logger.warn('Source cleanup failed and cleanup state update also failed', {
          jobId: job.id,
          documentId: job.document_id,
          cleanupError: errorMessage,
          stateError: stateError instanceof Error ? stateError.message : String(stateError),
        });
      }
      logger.warn('Source file cleanup threw after successful processing; queued for retry', {
        jobId: job.id,
        documentId: job.document_id,
        bucket,
        objectPath,
        message: errorMessage,
      });
    }
  }

  private async attemptJobCompletionUpdate(
    job: UploadJob,
    source: 'inline' | 'reconcile',
  ): Promise<WorkerJobMutationResult> {
    const nowIso = new Date().toISOString();
    const fullPayload = {
      status: 'completed',
      progress: 100,
      error: null,
      claimed_by: null,
      locked_at: null,
      locked_until: null,
      completed_at: nowIso,
      last_progress_at: nowIso,
      updated_at: nowIso,
    };

    let { error } = await this.supabase
      .from('au_worker_jobs')
      .update(fullPayload)
      .eq('id', job.id);

    if (!error) {
      return { ok: true, mode: 'full' };
    }

    const lifecycleColumns = ['completed_at', 'last_progress_at'];
    if (
      lifecycleColumns.some((column) =>
        this.isMissingColumnError(error, column) || this.isSchemaCacheMissingColumnError(error, column),
      )
    ) {
      this.warnSchemaFallbackOnce(`completion:${lifecycleColumns.join(',')}`, {
        jobId: job.id,
        documentId: job.document_id,
        source,
        missingColumns: lifecycleColumns.filter((column) =>
          this.isMissingColumnError(error, column) || this.isSchemaCacheMissingColumnError(error, column),
        ),
        message: error.message,
      });

      ({ error } = await this.supabase
        .from('au_worker_jobs')
        .update({
          status: 'completed',
          progress: 100,
          error: null,
          claimed_by: null,
          locked_at: null,
          locked_until: null,
          updated_at: nowIso,
        })
        .eq('id', job.id));

      if (!error) {
        return { ok: true, mode: 'legacy_schema_fallback' };
      }
    }

    if (error && this.isMissingColumnError(error, 'error')) {
      this.warnSchemaFallbackOnce('completion:error', {
        jobId: job.id,
        documentId: job.document_id,
        source,
        missingColumns: ['error'],
        message: error.message,
      });

      ({ error } = await this.supabase
        .from('au_worker_jobs')
        .update({
          status: 'completed',
          progress: 100,
          claimed_by: null,
          locked_at: null,
          locked_until: null,
          updated_at: nowIso,
        })
        .eq('id', job.id));

      if (!error) {
        return { ok: true, mode: 'legacy_schema_fallback' };
      }
    }

    const classified = this.classifyWorkerJobMutationError(error, ['completed_at', 'last_progress_at', 'error']);
    return {
      ok: false,
      classification: classified.classification,
      message: classified.message,
    };
  }

  private scheduleCompletionReconciliation(
    job: UploadJob,
    failure: { classification: WorkerJobMutationClassification; message: string },
    source: 'inline' | 'reconcile',
  ): void {
    const suppressedUntil = this.suppressedCompletionReconcileUntil.get(job.id);
    if (suppressedUntil && suppressedUntil > Date.now()) {
      return;
    }

    const previous = this.completionReconcileState.get(job.id);
    const attempts = (previous?.attempts || 0) + 1;
    const maxAttempts =
      failure.classification === 'logic_error'
        ? Math.min(2, this.completionReconcileMaxAttempts)
        : this.completionReconcileMaxAttempts;

    if (attempts > maxAttempts) {
      this.completionReconcileState.delete(job.id);
      this.suppressedCompletionReconcileUntil.set(job.id, Date.now() + Math.max(this.completionReconcileMaxMs, 3600000));
      logger.error('Worker-job completion reconciliation exhausted', {
        jobId: job.id,
        documentId: job.document_id,
        attempts: attempts - 1,
        classification: failure.classification,
        message: failure.message,
        source,
      });
      return;
    }

    const delayMs =
      failure.classification === 'schema_mismatch'
        ? this.completionReconcileMaxMs
        : Math.min(this.completionReconcileBaseMs * Math.pow(2, attempts - 1), this.completionReconcileMaxMs);

    this.completionReconcileState.set(job.id, {
      attempts,
      nextAttemptAt: Date.now() + delayMs,
      lastClassification: failure.classification,
      lastMessage: failure.message,
    });

    const logMethod = failure.classification === 'logic_error' ? logger.error : logger.warn;
    logMethod('Deferred worker-job completion reconciliation', {
      jobId: job.id,
      documentId: job.document_id,
      attempts,
      nextAttemptInMs: delayMs,
      classification: failure.classification,
      message: failure.message,
      source,
    });
  }

  private async finalizeCompletedJob(job: UploadJob, source: 'inline' | 'reconcile'): Promise<boolean> {
    try {
      const attempt = await this.attemptJobCompletionUpdate(job, source);
      if (!attempt.ok) {
        this.scheduleCompletionReconciliation(job, attempt, source);
        return false;
      }

      this.completionReconcileState.delete(job.id);
      this.suppressedCompletionReconcileUntil.delete(job.id);
      await this.cleanupSourceFileAfterSuccess(job);
      await this.incrementUsageCounters(String(job.owner_id || job.user_id || ''), {
        jobs_completed: 1,
      });

      if (source === 'reconcile') {
        logger.info('Worker-job completion reconciliation succeeded', {
          jobId: job.id,
          documentId: job.document_id,
          completionMode: attempt.mode,
        });
        await this.logDebug('Worker-job completion reconciliation succeeded', {
          jobId: job.id,
          documentId: job.document_id,
          completionMode: attempt.mode,
        });
        return true;
      }

      logger.info('Job completed', {
        jobId: job.id,
        documentId: job.document_id,
        completionMode: attempt.mode,
      });
      await this.logDebug('Job completed', {
        jobId: job.id,
        documentId: job.document_id,
        completionMode: attempt.mode,
      });
      return true;
    } catch (error) {
      const classified = this.classifyWorkerJobMutationError(error, ['completed_at', 'last_progress_at', 'error']);
      this.scheduleCompletionReconciliation(job, classified, source);
      return false;
    }
  }

  private async reconcileCompletedJobs() {
    const nowMs = Date.now();
    if (nowMs - this.lastCompletionReconcileAt < this.completionReconcileScanMs) return;
    this.lastCompletionReconcileAt = nowMs;

    try {
      const workerFilter = `worker_id.eq.${this.pipelineId},worker_id.is.null`;
      const { data, error } = await this.supabase
        .from('au_worker_jobs')
        .select('id,document_id,owner_id,user_id,bucket,object_path,status,progress,updated_at')
        .eq('status', 'processing')
        .eq('progress', 100)
        .or(workerFilter)
        .order('updated_at', { ascending: true })
        .limit(25);

      if (error) {
        const classified = this.classifyWorkerJobMutationError(error, ['completed_at', 'last_progress_at']);
        logger.warn('Failed to scan for worker jobs needing completion reconciliation', {
          classification: classified.classification,
          message: classified.message,
        });
        return;
      }

      for (const raw of data || []) {
        const job: UploadJob = {
          id: String(raw?.id || ''),
          document_id: String(raw?.document_id || ''),
          owner_id: raw?.owner_id ? String(raw.owner_id) : null,
          user_id: raw?.user_id ? String(raw.user_id) : null,
          bucket: this.normalizeBucketName(raw?.bucket, {
            jobId: String(raw?.id || ''),
            documentId: String(raw?.document_id || ''),
            source: 'completion-reconcile-scan',
          }),
          object_path: String(raw?.object_path || '').trim(),
          status: String(raw?.status || ''),
          progress: Number(raw?.progress || 0),
          updated_at: raw?.updated_at ? String(raw.updated_at) : undefined,
        };

        if (!job.id || !job.document_id) continue;

        const suppressedUntil = this.suppressedCompletionReconcileUntil.get(job.id);
        if (suppressedUntil && nowMs < suppressedUntil) continue;
        if (suppressedUntil && nowMs >= suppressedUntil) {
          this.suppressedCompletionReconcileUntil.delete(job.id);
        }

        const state = this.completionReconcileState.get(job.id);
        if (state && nowMs < state.nextAttemptAt) continue;

        const { data: docRow, error: docError } = await this.supabase
          .from('au_documents')
          .select('status')
          .eq('id', job.document_id)
          .maybeSingle();

        if (docError) {
          const classified = this.classifyWorkerJobMutationError(docError);
          this.scheduleCompletionReconciliation(job, classified, 'reconcile');
          continue;
        }

        const documentStatus = String((docRow as any)?.status || '').toLowerCase();
        if (!['completed', 'done', 'indexed'].includes(documentStatus)) {
          this.scheduleCompletionReconciliation(job, {
            classification: 'logic_error',
            message: `document_not_terminal:${documentStatus || 'unknown'}`,
          }, 'reconcile');
          continue;
        }

        await this.finalizeCompletedJob(job, 'reconcile');
      }
    } catch (error) {
      logger.warn('Completion reconciliation scan threw', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
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
          this.reconcileTerminalJobClaims(),
          this.reconcileCompletedJobs(),
        ]);
        await this.wait(this.pollIntervalMs);
      } catch (err) {
        logger.error('Worker loop error', err);
        await this.wait(Math.max(this.pollIntervalMs * 2, 5000));
      }
    }
  }

  stop() {
    this.isRunning = false;
    logger.info('Worker stopping');
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
      bucket: this.normalizeBucketName(raw.bucket, {
        jobId: String(raw.id || ''),
        documentId: String(raw.document_id || ''),
        source: 'claim',
      }),
      object_path: objectPath,
    };
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
      claimed_by: null,
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
        claimed_by: null,
        locked_at: null,
        locked_until: null,
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
    const bucket = this.canonicalBucket;
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
      await this.updateJobProgress(currentJob.id, 100);
      await this.finalizeCompletedJob(currentJob, 'inline');
    } catch (processErr) {
      logger.error('Job failed', { jobId: currentJob.id, error: processErr });

      const errorMessage = normalizeJobErrorMessage(processErr);
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
    const contentHash = computeHash(text);

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

    const currentExpiryRaw = String((currentDoc as any)?.expires_at || '').trim();
    const currentExpiryMs = currentExpiryRaw ? new Date(currentExpiryRaw).getTime() : Number.NaN;
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

    let fallbackRetentionDays = 14;
    if (!Number.isFinite(currentExpiryMs) && !inheritedParentExpiryMs) {
      const { data: entitlementRow } = await this.supabase
        .from('au_user_entitlements')
        .select('plan,source')
        .eq('user_id', ownerId)
        .maybeSingle();
      const entitlementPlan = String((entitlementRow as any)?.plan || 'free').toLowerCase();
      const entitlementSource = String((entitlementRow as any)?.source || 'none').toLowerCase();
      fallbackRetentionDays =
        entitlementSource === 'promo'
          ? 14
          : (entitlementPlan === 'premium' || entitlementPlan === 'pro' ? 30 : 14);
    }

    const effectiveExpiryMs = Number.isFinite(currentExpiryMs)
      ? currentExpiryMs
      : inheritedParentExpiryMs;
    const expiresAt = effectiveExpiryMs
      ? Math.floor(effectiveExpiryMs / 1000)
      : Math.floor(Date.now() / 1000) + (fallbackRetentionDays * 24 * 60 * 60);
    const retentionDays = effectiveExpiryMs
      ? Math.max(1, Math.ceil((effectiveExpiryMs - Date.now()) / (24 * 60 * 60 * 1000)))
      : fallbackRetentionDays;
    const expirySource = Number.isFinite(currentExpiryMs)
      ? 'document'
      : inheritedParentExpiryMs
        ? 'parent_textbook'
        : 'policy_fallback';

    await this.updateJobProgress(job.id, 70);
    await this.ingestion.processDocument(
      job.document_id,
      chunks,
      ownerId,
      expiresAt,
      contentHash,
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
