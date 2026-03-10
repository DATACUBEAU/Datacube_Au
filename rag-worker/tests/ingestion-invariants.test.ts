import { IngestionService } from '../src/ingestion';
import { computeHash } from '../src/utils';

function createSupabaseStub() {
  return {
    from: jest.fn().mockImplementation(() => ({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })),
  } as any;
}

function makeVector(dimensions = 384): number[] {
  return Array.from({ length: dimensions }, (_, index) => Number(index % 7) / 7);
}

describe('ingestion chunk invariants', () => {
  test('rejects zero-filled canonical chunk text before upsert', async () => {
    const service = new IngestionService(createSupabaseStub(), 'http://localhost:6333');
    (service as any).ensureCollection = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.processDocument(
        'doc-zero',
        ['000000000000000000000000'],
        'owner-1',
        Math.floor(Date.now() / 1000) + 3600,
      ),
    ).rejects.toThrow('invalid_chunk_text_zero_fill');
  });

  test('fails when Qdrant payload text diverges from canonical Supabase chunk text', async () => {
    const canonicalText = 'Canonical chunk text for invariant verification.';
    const service = new IngestionService(createSupabaseStub(), 'http://localhost:6333');

    (service as any).ensureCollection = jest.fn().mockResolvedValue(undefined);
    (service as any).clearChunkRows = jest.fn().mockResolvedValue(undefined);
    (service as any).insertChunkRows = jest.fn().mockResolvedValue(undefined);
    (service as any).countChunkRows = jest.fn().mockResolvedValue(1);
    (service as any).fetchChunkRowsForVerification = jest.fn().mockResolvedValue([
      {
        id: 'point-1',
        document_id: 'doc-invariant',
        chunk_index: 0,
        text: canonicalText,
      },
    ]);
    (service as any).getEmbedder = jest.fn().mockResolvedValue({
      kind: 'transformers',
      extractor: async (_texts: string[]) => [makeVector(384)],
    });

    const qdrant = {
      delete: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue({ count: 1 }),
      scroll: jest.fn().mockResolvedValue({
        points: [
          {
            id: 'point-1',
            vector: makeVector(384),
            payload: {
              document_id: 'doc-invariant',
              owner_id: 'owner-1',
              user_id: 'owner-1',
              chunk_index: 0,
              text: '0000000000',
              text_hash: computeHash('0000000000'),
            },
          },
        ],
        next_page_offset: null,
      }),
    };
    (service as any).qdrant = qdrant;

    await expect(
      service.processDocument(
        'doc-invariant',
        [canonicalText],
        'owner-1',
        Math.floor(Date.now() / 1000) + 3600,
      ),
    ).rejects.toThrow('invalid_chunk_text_zero_fill');

    expect(qdrant.upsert).toHaveBeenCalledTimes(1);
  });
});
