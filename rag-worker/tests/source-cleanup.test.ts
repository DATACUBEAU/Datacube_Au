import { finalizeDocumentSourceCleanup } from '../src/source-cleanup';

type DocSnapshot = {
  id: string;
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
      preferredObjectPath: 'wrong/path.pdf',
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
      defaultBucket: 'documents',
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('already_missing');
    expect(stub.storageRemoveCalls).toHaveLength(0);
  });
});
