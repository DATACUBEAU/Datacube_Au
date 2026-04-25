import { RAGWorker } from '../src/worker';

class FakeWorkerJobsQuery {
  private mode: 'update' | null = null;
  private payload: Record<string, unknown> | null = null;

  constructor(private parent: FakeSupabase) {}

  update(payload: Record<string, unknown>) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }

  eq(column: string, value: string) {
    if (this.mode === 'update' && column === 'id') {
      this.parent.jobUpdates.push({ id: value, payload: this.payload || {} });
      const error = this.parent.jobUpdateErrors.length > 0 ? this.parent.jobUpdateErrors.shift() : null;
      return Promise.resolve({ error });
    }
    return this;
  }
}

class FakeDocumentQuery {
  private mode: 'select' | 'update' | null = null;
  private payload: Record<string, unknown> | null = null;

  constructor(private parent: FakeSupabase) {}

  select() {
    this.mode = 'select';
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }

  eq(column: string, value: string) {
    if (column !== 'id') return this;
    if (this.mode === 'update') {
      this.parent.documentUpdates.push({ id: value, payload: this.payload || {} });
      return Promise.resolve({ error: null });
    }
    return this;
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.parent.documentSelectRow,
      error: null,
    });
  }
}

class FakeDebugLogQuery {
  constructor(private parent: FakeSupabase) {}

  insert(payload: Record<string, unknown>) {
    this.parent.debugLogs.push(payload);
    return Promise.resolve({ error: null });
  }
}

class FakeSupabase {
  public jobUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  public documentUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  public debugLogs: Array<Record<string, unknown>> = [];
  public jobUpdateErrors: any[] = [];
  public documentSelectRow: Record<string, unknown> = { cleanup_attempts: 0 };

  from(table: string) {
    if (table === 'au_worker_jobs') return new FakeWorkerJobsQuery(this);
    if (table === 'au_documents') return new FakeDocumentQuery(this);
    if (table === 'au_debug_logs') return new FakeDebugLogQuery(this);
    throw new Error(`Unexpected table access in test: ${table}`);
  }
}

describe('RAGWorker completion reconciliation', () => {
  const job = {
    id: 'job-1',
    document_id: 'doc-1',
    owner_id: 'owner-1',
    user_id: 'owner-1',
    bucket: 'documents',
    object_path: 'owner/documents/file.pdf',
  };

  test('falls back to legacy completion update when lifecycle columns are missing', async () => {
    const supabase = new FakeSupabase();
    supabase.jobUpdateErrors = [
      { message: 'column "completed_at" does not exist', status: 400 },
      null,
    ];
    const worker = new RAGWorker(supabase as any, {} as any);

    const result = await (worker as any).attemptJobCompletionUpdate(job, 'inline');

    expect(result).toEqual({ ok: true, mode: 'legacy_schema_fallback' });
    expect(supabase.jobUpdates).toHaveLength(2);
    expect(supabase.jobUpdates[0].payload).toMatchObject({
      status: 'completed',
      progress: 100,
      completed_at: expect.any(String),
      last_progress_at: expect.any(String),
    });
    expect(supabase.jobUpdates[1].payload).toMatchObject({
      status: 'completed',
      progress: 100,
      updated_at: expect.any(String),
    });
    expect(supabase.jobUpdates[1].payload.completed_at).toBeUndefined();
    expect(supabase.jobUpdates[1].payload.last_progress_at).toBeUndefined();
  });

  test('schedules bounded reconciliation on transient completion update failure without running cleanup', async () => {
    const supabase = new FakeSupabase();
    supabase.jobUpdateErrors = [
      { message: 'connection timeout', status: 503 },
    ];
    const worker = new RAGWorker(supabase as any, {} as any);
    const cleanupSpy = jest.spyOn(worker as any, 'cleanupSourceFileAfterSuccess').mockResolvedValue(undefined);
    const usageSpy = jest.spyOn(worker as any, 'incrementUsageCounters').mockResolvedValue(undefined);

    await expect((worker as any).finalizeCompletedJob(job, 'inline')).resolves.toBe(false);

    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(usageSpy).not.toHaveBeenCalled();
    const state = (worker as any).completionReconcileState.get(job.id);
    expect(state).toMatchObject({
      attempts: 1,
      lastClassification: 'transient_db',
      lastMessage: 'connection timeout',
    });
    expect(state.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  test('clears reconcile state and runs cleanup only after durable completion succeeds', async () => {
    const supabase = new FakeSupabase();
    const worker = new RAGWorker(supabase as any, {} as any);
    (worker as any).completionReconcileState.set(job.id, {
      attempts: 2,
      nextAttemptAt: 0,
      lastClassification: 'transient_db',
      lastMessage: 'connection timeout',
    });
    const cleanupSpy = jest.spyOn(worker as any, 'cleanupSourceFileAfterSuccess').mockResolvedValue(undefined);
    const usageSpy = jest.spyOn(worker as any, 'incrementUsageCounters').mockResolvedValue(undefined);
    const debugSpy = jest.spyOn(worker as any, 'logDebug').mockResolvedValue(undefined);

    await expect((worker as any).finalizeCompletedJob(job, 'reconcile')).resolves.toBe(true);

    expect((worker as any).completionReconcileState.has(job.id)).toBe(false);
    expect(cleanupSpy).toHaveBeenCalledWith(job);
    expect(usageSpy).toHaveBeenCalledWith('owner-1', { jobs_completed: 1 });
    expect(debugSpy).toHaveBeenCalledWith('Worker-job completion reconciliation succeeded', {
      jobId: 'job-1',
      documentId: 'doc-1',
      completionMode: 'full',
    });
  });

  test('drops reconcile state after retry budget is exhausted', () => {
    const worker = new RAGWorker(new FakeSupabase() as any, {} as any);

    for (let index = 0; index < 7; index += 1) {
      (worker as any).scheduleCompletionReconciliation(
        job,
        { classification: 'transient_db', message: 'db unavailable' },
        'reconcile',
      );
    }

    expect((worker as any).completionReconcileState.has(job.id)).toBe(false);
    expect((worker as any).suppressedCompletionReconcileUntil.get(job.id)).toBeGreaterThan(Date.now());
  });
});
