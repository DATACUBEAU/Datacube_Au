import { RAGWorker } from '../src/worker';
import { IngestionService } from '../src/ingestion';
import { SupabaseClient } from '@supabase/supabase-js';

import { PDFDocument } from 'pdf-lib';

describe('Ingestion Validation', () => {
  let worker: RAGWorker;
  let ingestion: IngestionService;
  let supabase: SupabaseClient;

  beforeEach(() => {
    supabase = {
      from: jest.fn(),
      storage: {
        from: jest.fn().mockReturnThis(),
        download: jest.fn(),
        remove: jest.fn(),
      },
      rpc: jest.fn(),
    } as unknown as SupabaseClient;

    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: {} }) }),
      insert: jest.fn().mockResolvedValue({ data: {} }),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { document_type: 'textbook' } })
    }));

    ingestion = new IngestionService(supabase, 'http://localhost:6333');
    ingestion['qdrant'] = {
      upsert: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue({ count: 1 }),
      getCollection: jest.fn(),
      createPayloadIndex: jest.fn(),
    } as any;

    ingestion['getEmbedder'] = jest.fn().mockResolvedValue({
      kind: 'fastembed',
      model: {
        embed: jest.fn().mockResolvedValue([new Float32Array(384), new Float32Array(384)]),
      },
      embedTexts: jest.fn().mockResolvedValue([new Float32Array(384), new Float32Array(384)]),
    });

    worker = new RAGWorker(supabase, ingestion);
  });


  it('should process a valid text document successfully', async () => {
    const job = {
      id: 'job-id',
      document_id: 'doc-id',
      object_path: 'test.txt',
      bucket: 'documents',
      owner_id: 'user-id',
    };
    const text = 'This is a valid text document with enough content to pass the sanity checks. '.repeat(20);
    const buffer = Buffer.from(text);

    (supabase.storage.from('documents').download as jest.Mock).mockResolvedValueOnce({ data: { arrayBuffer: () => Promise.resolve(buffer) } });
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: {} }) }),
      insert: jest.fn().mockResolvedValue({ data: {} }),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { document_type: 'textbook' } })
    }));

    ingestion['getEmbedder'] = jest.fn().mockResolvedValue({
      kind: 'fastembed',
      model: {
        embed: jest.fn().mockResolvedValue([new Float32Array(384), new Float32Array(384)]),
      },
      embedTexts: jest.fn().mockResolvedValue([new Float32Array(384), new Float32Array(384)]),
    });

    ingestion['countChunkRows'] = jest.fn().mockResolvedValue(2);
    (ingestion['qdrant'].count as jest.Mock).mockResolvedValue({ count: 2 });

    await expect(worker['processJob'](job as any)).resolves.not.toThrow();
  });

  it('should fail for a scanned PDF with an ocr_required error', async () => {
    const job = {
      id: 'job-id',
      document_id: 'doc-id',
      object_path: 'test.pdf',
      bucket: 'documents',
      owner_id: 'user-id',
    };
    const pdfDoc = await PDFDocument.create();
    const buffer = await pdfDoc.save();

    (supabase.storage.from('documents').download as jest.Mock).mockResolvedValueOnce({ data: { arrayBuffer: () => Promise.resolve(buffer) } });
    ingestion['countChunkRows'] = jest.fn().mockResolvedValue(1);

    await expect(worker['processJob'](job as any)).rejects.toThrow('ocr_required');
  });

  it('should fail for a document with placeholder zeros', async () => {
    const job = {
      id: 'job-id',
      document_id: 'doc-id',
      object_path: 'test.txt',
      bucket: 'documents',
      owner_id: 'user-id',
    };
    const text = '0'.repeat(1000);
    const buffer = Buffer.from(text);

    (supabase.storage.from('documents').download as jest.Mock).mockResolvedValueOnce({ data: { arrayBuffer: () => Promise.resolve(buffer) } });
    ingestion['countChunkRows'] = jest.fn().mockResolvedValue(1);

    await expect(worker['processJob'](job as any)).rejects.toThrow('extract_placeholder_zeros');
  });
});
