import { RAGWorker } from '../src/worker';
import { IngestionService } from '../src/ingestion';
import { SupabaseClient } from '@supabase/supabase-js';

// Create mock functions
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockEq = jest.fn();
const mockIn = jest.fn();
const mockLt = jest.fn();
const mockOr = jest.fn();
const mockIs = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockMaybeSingle = jest.fn();
const mockRpc = jest.fn();
const mockStorageFrom = jest.fn();
const mockStorageDownload = jest.fn();
const mockStorageRemove = jest.fn();

// Create a builder object that has all these methods
// It is also a Thenable to support await .eq()
const builder: any = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  eq: mockEq,
  in: mockIn,
  lt: mockLt,
  or: mockOr,
  is: mockIs,
  order: mockOrder,
  limit: mockLimit,
  maybeSingle: mockMaybeSingle,
  then: (resolve: any) => resolve({ data: [], error: null }), // Default resolve
};

// Make methods return the builder for chaining
mockSelect.mockReturnValue(builder);
mockInsert.mockReturnValue(builder);
mockUpdate.mockReturnValue(builder);
mockDelete.mockReturnValue(builder);
mockEq.mockReturnValue(builder);
mockIn.mockReturnValue(builder);
mockLt.mockReturnValue(builder);
mockOr.mockReturnValue(builder);
mockIs.mockReturnValue(builder);
mockOrder.mockReturnValue(builder);
// mockLimit is NOT returning builder, it returns the result promise directly in our test case

const mockSupabase = {
  from: jest.fn(() => builder),
  rpc: mockRpc,
  storage: {
    from: mockStorageFrom,
  },
} as unknown as SupabaseClient;

const mockIngestion = {
  ensureStartupIndexes: jest.fn(),
  processDocument: jest.fn(),
  deleteDocument: jest.fn(),
} as unknown as IngestionService;

describe('RAGWorker Lifecycle', () => {
  let worker: RAGWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Storage
    mockStorageFrom.mockReturnValue({
      download: mockStorageDownload,
      remove: mockStorageRemove,
    });
    mockStorageRemove.mockResolvedValue({ error: null });
    
    mockRpc.mockResolvedValue({ data: [], error: null });

    worker = new RAGWorker(mockSupabase, mockIngestion);
  });

  test('reconcileStuckJobs should fix jobs stuck at 100% analyzing', async () => {
    const stuckJob = {
      id: 'job-stuck-100',
      document_id: 'doc-stuck-100',
      status: 'processing',
      progress: 100,
      bucket: 'documents',
      object_path: 'test.pdf',
      owner_id: 'user-1',
      updated_at: new Date(Date.now() - 120000).toISOString(), // 2 mins ago
    };

    // 1. stuckCompleted query: limit(5)
    // 2. staleJobs query: limit(5)
    
    mockLimit.mockImplementationOnce(() => Promise.resolve({ data: [stuckJob], error: null }));
    mockLimit.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));

    // builder.then will handle the update().eq() resolution
    
    await (worker as any).reconcileStuckJobs();

    // Check if update was called with correct status
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      progress: 100,
    }));
    
    // Check if storage cleanup was called
    expect(mockStorageRemove).toHaveBeenCalledWith(['test.pdf']);
  });

  test('reconcileStuckJobs should fail stale processing jobs', async () => {
    const staleJob = {
      id: 'job-stale',
      document_id: 'doc-stale',
      status: 'processing',
      progress: 50,
      bucket: 'documents',
      object_path: 'stale.pdf',
      owner_id: 'user-1',
      updated_at: new Date(Date.now() - 20 * 60000).toISOString(), // 20 mins ago
    };

    // 1. stuckCompleted query -> []
    // 2. staleJobs query -> [staleJob]
    mockLimit.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));
    mockLimit.mockImplementationOnce(() => Promise.resolve({ data: [staleJob], error: null }));
    
    await (worker as any).reconcileStuckJobs();

    // Check if update was called with failed status
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('stale'),
    }));
  });
});
