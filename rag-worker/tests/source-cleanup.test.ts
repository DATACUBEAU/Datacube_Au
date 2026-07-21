import { finalizeDocumentSourceCleanup } from '../src/source-cleanup';

type DocSnapshot = {
  id: string;
  owner_id?: string | null;
  user_id?: string | null;
  status?: string | null;
  file_path: string | null;
  cleanup_attempts: number;
  storage_deleted_at?: string | null;
  source_deleted_at?: string | null;
};

function createSupabaseStub(input: {
  doc: DocSnapshot;
  storageListResult?: { data: any[] | null; error: any | null };
  storageRemoveResult?: { error: any | null };
}) {
  const updatePayloads: Array<Record<string, unknown>> = [];
  const storageListCalls: Array<{ bucket: string; folder: string; search: string }> = [];
  const storageRemoveCalls: Array<{ bucket: string; paths: string[] }> = [];

  const queryBuilder: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockImplementation(async () => ({
      data: input.doc,
      error: null,
    })),
    update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
      updatePayloads.push(payload);
      return {
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
    }),
  };

  const supabase: any = {
    from: jest.fn().mockImplementation((table: string) => {
      if (table !== 'au_documents') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return queryBuilder;
    }),
    storage: {
      from: jest.fn().mockImplementation((bucket: string) => ({
        list: jest.fn().mockImplementation(async (folder: string, opts: { search: string }) => {
          storageListCalls.push({ bucket, folder, search: opts.search });
          return input.storageListResult ?? { data: [{ name: opts.search }], error: null };
        }),
        remove: jest.fn().mockImplementation(async (paths: string[]) => {
          storageRemoveCalls.push({ bucket, paths });
          return input.storageRemoveResult ?? { error: null };
        }),
      })),
    },
  };

  return {
    supabase,
    updatePayloads,
    storageListCalls,
    storageRemoveCalls,
  };
}

describe('source cleanup finalization', () => {
  test('uses canonical au_documents.file_path for deletion', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-1',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'completed',
        file_path: 'user/ingestion/past-questions/doc-1.pdf',
        cleanup_attempts: 0,
        storage_deleted_at: null,
        source_deleted_at: null,
      },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-1',
      preferredBucket: 'documents',
      preferredObjectPath: 'user/ingestion/past-questions/doc-1.pdf',
      expectedOwnerId: 'user-1',
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('deleted');
    expect(stub.storageRemoveCalls).toEqual([
      { bucket: 'documents', paths: ['user/ingestion/past-questions/doc-1.pdf'] },
    ]);
    expect(stub.updatePayloads[stub.updatePayloads.length - 1]).toEqual(
      expect.objectContaining({
        cleanup_pending: false,
        source_cleanup_result: 'deleted',
      }),
    );
  });

  test('does not re-delete when source was already deleted', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-2',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'completed',
        file_path: 'user/ingestion/main-textbooks/doc-2.pdf',
        cleanup_attempts: 3,
        storage_deleted_at: '2026-03-09T00:00:00.000Z',
        source_deleted_at: '2026-03-09T00:00:00.000Z',
      },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-2',
      preferredBucket: 'documents',
      preferredObjectPath: 'user/ingestion/main-textbooks/doc-2.pdf',
      expectedOwnerId: 'user-1',
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('already_deleted');
    expect(stub.storageRemoveCalls).toHaveLength(0);
  });

  test('marks success when source object is already missing', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-3',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'completed',
        file_path: 'user/ingestion/past-questions/doc-3.pdf',
        cleanup_attempts: 1,
        storage_deleted_at: null,
        source_deleted_at: null,
      },
      storageListResult: { data: [], error: null },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-3',
      preferredBucket: 'documents',
      preferredObjectPath: null,
      expectedOwnerId: 'user-1',
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('already_missing');
    expect(stub.storageRemoveCalls).toHaveLength(0);
  });

  test('does not delete when document is not completed', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-4',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'failed',
        file_path: 'user/ingestion/past-questions/doc-4.pdf',
        cleanup_attempts: 0,
        storage_deleted_at: null,
        source_deleted_at: null,
      },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-4',
      preferredBucket: 'documents',
      preferredObjectPath: 'user/ingestion/past-questions/doc-4.pdf',
      expectedOwnerId: 'user-1',
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('not_completed');
    expect(stub.storageRemoveCalls).toHaveLength(0);
  });

  test('does not delete when job owner does not match document owner', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-5',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'completed',
        file_path: 'user/ingestion/past-questions/doc-5.pdf',
        cleanup_attempts: 0,
        storage_deleted_at: null,
        source_deleted_at: null,
      },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-5',
      preferredBucket: 'documents',
      preferredObjectPath: 'user/ingestion/past-questions/doc-5.pdf',
      expectedOwnerId: 'user-2',
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('owner_mismatch');
    expect(stub.storageRemoveCalls).toHaveLength(0);
  });

  test('does not delete when worker path does not match document path', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-6',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'completed',
        file_path: 'user/ingestion/past-questions/doc-6.pdf',
        cleanup_attempts: 0,
        storage_deleted_at: null,
        source_deleted_at: null,
      },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-6',
      preferredBucket: 'documents',
      preferredObjectPath: 'user/ingestion/other/doc-6.pdf',
      expectedOwnerId: 'user-1',
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('path_mismatch');
    expect(stub.storageRemoveCalls).toHaveLength(0);
  });

  test('bounds repeated cleanup attempts', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-7',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'completed',
        file_path: 'user/ingestion/past-questions/doc-7.pdf',
        cleanup_attempts: 3,
        storage_deleted_at: null,
        source_deleted_at: null,
      },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-7',
      preferredBucket: 'documents',
      preferredObjectPath: 'user/ingestion/past-questions/doc-7.pdf',
      expectedOwnerId: 'user-1',
      defaultBucket: 'documents',
      maxAttempts: 3,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('max_attempts_exceeded');
    expect(stub.storageRemoveCalls).toHaveLength(0);
  });

  test('records deletion failure without failing completed ingestion', async () => {
    const stub = createSupabaseStub({
      doc: {
        id: 'doc-8',
        owner_id: 'user-1',
        user_id: 'user-1',
        status: 'completed',
        file_path: 'user/ingestion/past-questions/doc-8.pdf',
        cleanup_attempts: 1,
        storage_deleted_at: null,
        source_deleted_at: null,
      },
      storageRemoveResult: { error: { message: 'permission denied', status: 500 } },
    });

    const result = await finalizeDocumentSourceCleanup({
      supabase: stub.supabase,
      documentId: 'doc-8',
      preferredBucket: 'documents',
      preferredObjectPath: 'user/ingestion/past-questions/doc-8.pdf',
      expectedOwnerId: 'user-1',
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('delete_failed');
    expect(stub.storageRemoveCalls).toEqual([
      { bucket: 'documents', paths: ['user/ingestion/past-questions/doc-8.pdf'] },
    ]);
    expect(stub.updatePayloads[stub.updatePayloads.length - 1]).toEqual(
      expect.objectContaining({
        cleanup_pending: true,
        source_cleanup_result: 'delete_failed',
      }),
    );
  });
});
