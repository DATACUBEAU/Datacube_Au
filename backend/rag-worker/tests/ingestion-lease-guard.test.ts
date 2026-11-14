import { IngestionService } from '../src/ingestion';
import { WorkerLeaseLostError } from '../src/worker-lease';

describe('ingestion lease checkpoints', () => {
  test('checks ownership between chunk insert batches and stops on lease loss', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const supabase = { from: jest.fn(() => ({ insert })) };
    const service = new IngestionService(supabase as any, 'http://localhost:6333');
    (service as any).chunkInsertBatchSize = 1;

    let guardCalls = 0;
    const guard = jest.fn(async () => {
      guardCalls += 1;
      if (guardCalls === 2) throw new WorkerLeaseLostError('job-lease');
    });

    await expect((service as any).insertChunkRows([
      { id: 'chunk-1', document_id: 'doc-1', owner_id: 'owner-1', user_id: 'owner-1', chunk_index: 0, text: 'first' },
      { id: 'chunk-2', document_id: 'doc-1', owner_id: 'owner-1', user_id: 'owner-1', chunk_index: 1, text: 'second' },
    ], guard)).rejects.toBeInstanceOf(WorkerLeaseLostError);

    expect(guard).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
