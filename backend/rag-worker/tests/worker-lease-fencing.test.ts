import { RAGWorker } from '../src/worker';

type QueryResult = { data: { id: string } | null; error: any };

class FakeWorkerJobQuery {
  private filters: Array<[string, unknown]> = [];

  constructor(
    private parent: FakeSupabase,
    private payload: Record<string, unknown>,
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  select() {
    return this;
  }

  async maybeSingle(): Promise<QueryResult> {
    this.parent.calls.push({ payload: this.payload, filters: [...this.filters] });
    if (this.parent.error) {
      return { data: null, error: this.parent.error };
    }

    const claimedBy = this.filters.find(([column]) => column === 'claimed_by')?.[1];
    const status = this.filters.find(([column]) => column === 'status')?.[1];
    const id = this.filters.find(([column]) => column === 'id')?.[1];
    const owned = claimedBy === this.parent.currentOwner && status === 'processing';

    return {
      data: owned ? { id: String(id) } : null,
      error: null,
    };
  }
}

class FakeWorkerJobTable {
  constructor(private parent: FakeSupabase) {}

  update(payload: Record<string, unknown>) {
    return new FakeWorkerJobQuery(this.parent, payload);
  }
}

class FakeSupabase {
  public currentOwner = 'worker-a';
  public error: any = null;
  public calls: Array<{
    payload: Record<string, unknown>;
    filters: Array<[string, unknown]>;
  }> = [];

  from(table: string) {
    if (table !== 'au_worker_jobs') {
      throw new Error(`Unexpected table access in test: ${table}`);
    }
    return new FakeWorkerJobTable(this);
  }
}

describe('backend RAGWorker durable lease fencing', () => {
  const originalWorkerInstanceId = process.env.WORKER_INSTANCE_ID;
  const originalHeartbeatMs = process.env.WORKER_LEASE_HEARTBEAT_MS;

  beforeEach(() => {
    process.env.WORKER_INSTANCE_ID = 'worker-a';
    process.env.WORKER_LEASE_HEARTBEAT_MS = '10000';
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalWorkerInstanceId === undefined) {
      delete process.env.WORKER_INSTANCE_ID;
    } else {
      process.env.WORKER_INSTANCE_ID = originalWorkerInstanceId;
    }
    if (originalHeartbeatMs === undefined) {
      delete process.env.WORKER_LEASE_HEARTBEAT_MS;
    } else {
      process.env.WORKER_LEASE_HEARTBEAT_MS = originalHeartbeatMs;
    }
  });

  test('claim-fenced mutation requires id, processing status, and current claimed_by owner', async () => {
    const supabase = new FakeSupabase();
    const worker = new RAGWorker(supabase as any, {} as any);

    const result = await (worker as any).updateClaimedJobRow('job-1', {
      progress: 40,
      updated_at: new Date().toISOString(),
    });

    expect(result).toEqual({ updated: true, error: null });
    expect(supabase.calls).toHaveLength(1);
    expect(supabase.calls[0].filters).toEqual([
      ['id', 'job-1'],
      ['status', 'processing'],
      ['claimed_by', 'worker-a'],
    ]);
  });

  test('stale worker cannot update progress after another worker owns the job', async () => {
    const supabase = new FakeSupabase();
    supabase.currentOwner = 'worker-b';
    const worker = new RAGWorker(supabase as any, {} as any);

    await expect((worker as any).updateJobProgress('job-2', 55)).rejects.toMatchObject({
      name: 'WorkerLeaseLostError',
    });

    expect(supabase.calls).toHaveLength(1);
    expect(supabase.calls[0].filters).toContainEqual(['claimed_by', 'worker-a']);
  });

  test('datastore errors remain errors instead of being classified as ownership loss', async () => {
    const supabase = new FakeSupabase();
    supabase.error = { message: 'connection timeout', code: '08006' };
    const worker = new RAGWorker(supabase as any, {} as any);

    const result = await (worker as any).updateClaimedJobRow('job-3', {
      progress: 60,
      updated_at: new Date().toISOString(),
    });

    expect(result.updated).toBe(false);
    expect(result.error).toEqual(supabase.error);
  });

  test('heartbeat stops attempting renewals after durable ownership changes', async () => {
    jest.useFakeTimers();
    const supabase = new FakeSupabase();
    supabase.currentOwner = 'worker-b';
    const worker = new RAGWorker(supabase as any, {} as any);

    const stop = (worker as any).beginLeaseHeartbeat('job-4');

    jest.advanceTimersByTime(10000);
    await Promise.resolve();
    await Promise.resolve();
    expect(supabase.calls).toHaveLength(1);
    expect(supabase.calls[0].filters).toContainEqual(['claimed_by', 'worker-a']);
    expect(supabase.calls[0].payload).not.toHaveProperty('claimed_by');

    jest.advanceTimersByTime(20000);
    await Promise.resolve();
    await Promise.resolve();
    expect(supabase.calls).toHaveLength(1);

    stop();
  });

  test('lease loss does not mark the reclaimed job or document failed or increment failure usage', async () => {
    const supabase = new FakeSupabase();
    supabase.currentOwner = 'worker-b';
    const worker = new RAGWorker(supabase as any, {} as any);
    const stopHeartbeat = jest.fn();
    const markJobFailed = jest.fn();
    const markDocumentFailed = jest.fn();
    const incrementUsageCounters = jest.fn();

    (worker as any).claimJob = jest.fn().mockResolvedValue({
      id: 'job-5',
      document_id: 'doc-5',
      owner_id: 'owner-5',
      user_id: 'owner-5',
      bucket: 'documents',
      object_path: 'owner-5/doc-5.pdf',
    });
    (worker as any).logDebug = jest.fn().mockResolvedValue(undefined);
    (worker as any).beginLeaseHeartbeat = jest.fn().mockReturnValue(stopHeartbeat);
    (worker as any).markJobFailed = markJobFailed;
    (worker as any).markDocumentFailed = markDocumentFailed;
    (worker as any).incrementUsageCounters = incrementUsageCounters;

    await expect((worker as any).pollJobs()).resolves.toBeUndefined();

    expect(markJobFailed).not.toHaveBeenCalled();
    expect(markDocumentFailed).not.toHaveBeenCalled();
    expect(incrementUsageCounters).not.toHaveBeenCalled();
    expect(stopHeartbeat).toHaveBeenCalledTimes(1);
  });
});
