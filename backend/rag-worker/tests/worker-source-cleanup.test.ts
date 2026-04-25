import { RAGWorker } from '../src/worker';

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
      this.parent.updates.push({ id: value, payload: this.payload || {} });
      return Promise.resolve({ error: this.parent.updateError });
    }
    return this;
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.parent.selectRow,
      error: this.parent.selectError,
    });
  }
}

class FakeSupabase {
  public updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  public removed: Array<{ bucket: string; paths: string[] }> = [];
  public selectRow: Record<string, unknown> = { cleanup_attempts: 0 };
  public selectError: any = null;
  public updateError: any = null;
  public storageError: any = null;

  storage = {
    from: (bucket: string) => ({
      remove: async (paths: string[]) => {
        this.removed.push({ bucket, paths });
        return { error: this.storageError };
      },
    }),
  };

  from(table: string) {
    if (table !== 'au_documents') {
      throw new Error(`Unexpected table access in test: ${table}`);
    }
    return new FakeDocumentQuery(this);
  }
}

describe('RAGWorker source cleanup', () => {
  test('deletes source file after successful processing and records cleanup success', async () => {
    const supabase = new FakeSupabase();
    const worker = new RAGWorker(supabase as any, {} as any);

    await (worker as any).cleanupSourceFileAfterSuccess({
      id: 'job-1',
      document_id: 'doc-1',
      bucket: 'documents',
      object_path: 'owner/documents/file.pdf',
    });

    expect(supabase.removed).toEqual([
      { bucket: 'documents', paths: ['owner/documents/file.pdf'] },
    ]);
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).toMatchObject({
      id: 'doc-1',
      payload: expect.objectContaining({
        cleanup_pending: false,
        cleanup_attempts: 1,
        cleanup_last_error: null,
        source_cleanup_result: 'deleted',
      }),
    });
    expect(supabase.updates[0].payload.storage_deleted_at).toEqual(expect.any(String));
    expect(supabase.updates[0].payload.source_deleted_at).toEqual(expect.any(String));
  });

  test('treats missing source files as successful idempotent cleanup', async () => {
    const supabase = new FakeSupabase();
    supabase.selectRow = { cleanup_attempts: 2 };
    supabase.storageError = { message: 'Object not found', status: 404 };
    const worker = new RAGWorker(supabase as any, {} as any);

    await (worker as any).cleanupSourceFileAfterSuccess({
      id: 'job-2',
      document_id: 'doc-2',
      bucket: 'documents',
      object_path: 'owner/documents/missing.pdf',
    });

    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).toMatchObject({
      id: 'doc-2',
      payload: expect.objectContaining({
        cleanup_pending: false,
        cleanup_attempts: 3,
        cleanup_last_error: null,
        source_cleanup_result: 'missing',
      }),
    });
  });

  test('keeps completed ingestion successful and flags retry when source deletion fails', async () => {
    const supabase = new FakeSupabase();
    supabase.selectRow = { cleanup_attempts: 1 };
    supabase.storageError = { message: 'permission denied', status: 500 };
    const worker = new RAGWorker(supabase as any, {} as any);

    await expect(
      (worker as any).cleanupSourceFileAfterSuccess({
        id: 'job-3',
        document_id: 'doc-3',
        bucket: 'documents',
        object_path: 'owner/documents/protected.pdf',
      }),
    ).resolves.toBeUndefined();

    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).toMatchObject({
      id: 'doc-3',
      payload: expect.objectContaining({
        cleanup_pending: true,
        cleanup_attempts: 2,
        cleanup_last_error: 'permission denied',
        source_cleanup_result: 'delete_failed',
      }),
    });
    expect(supabase.updates[0].payload.storage_deleted_at).toBeUndefined();
    expect(supabase.updates[0].payload.source_deleted_at).toBeUndefined();
  });
});
