
import { SupabaseClient } from '@supabase/supabase-js';
import { logger, computeHash } from './utils';
import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'crypto';

type ChunkRow = {
  id: string;
  document_id: string;
  owner_id?: string;
  user_id?: string;
  chunk_index: number;
  text: string;
};

export class IngestionService {
  private embeddingModel?: FlagEmbedding;
  private qdrant: QdrantClient;
  private pipelineId: string;
  private chunkInsertBatchSize: number;
  private embedBatchSize: number;
  private qdrantRetryCount: number;

  constructor(
    private supabase: SupabaseClient,
    qdrantUrl: string,
    qdrantApiKey?: string
  ) {
    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
      checkCompatibility: false,
    });
    this.pipelineId = process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker';
    this.chunkInsertBatchSize = this.parsePositiveInt(process.env.CHUNK_INSERT_BATCH_SIZE, 250);
    this.embedBatchSize = this.parsePositiveInt(process.env.EMBED_BATCH_SIZE, 96);
    this.qdrantRetryCount = this.parsePositiveInt(process.env.QDRANT_RETRY_COUNT, 3);
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isMissingTableError(error: any): boolean {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return (
      code === 'PGRST205' ||
      (message.includes('could not find the table') && message.includes('au_document_chunks'))
    );
  }

  private isMissingColumnError(error: any, column: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    const target = column.toLowerCase();
    return (
      message.includes(target) && message.includes('does not exist')
    ) || (
      details.includes(target) && details.includes('does not exist')
    );
  }

  private isRetryableQdrantError(error: any): boolean {
    const status = Number(error?.status || error?.statusCode || 0);
    if ([408, 409, 429, 500, 502, 503, 504].includes(status)) return true;

    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('temporarily unavailable') ||
      message.includes('connection reset') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up')
    );
  }

  private async withQdrantRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.qdrantRetryCount; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= this.qdrantRetryCount || !this.isRetryableQdrantError(error)) {
          throw error;
        }
        const backoffMs = Math.min(400 * (2 ** (attempt - 1)), 3000);
        logger.warn(`${label} failed, retrying`, {
          attempt,
          backoffMs,
          message: error instanceof Error ? error.message : String(error),
        });
        await this.wait(backoffMs);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
  }

  private async getModel() {
    if (!this.embeddingModel) {
      logger.info('Initializing FastEmbed model: AllMiniLML6V2');
      this.embeddingModel = await FlagEmbedding.init({
        model: EmbeddingModel.AllMiniLML6V2,
      });
    }
    return this.embeddingModel;
  }

  private ownerFilter(documentId: string, ownerId: string) {
    return {
      must: [
        { key: 'document_id', match: { value: documentId } },
      ],
      should: [
        { key: 'owner_id', match: { value: ownerId } },
        { key: 'user_id', match: { value: ownerId } },
      ],
    } as any;
  }

  private async ensureCollection(collectionName: string): Promise<void> {
    try {
      await this.withQdrantRetry('Qdrant getCollection', () => this.qdrant.getCollection(collectionName));
      return;
    } catch (error: any) {
      if (Number(error?.status) !== 404 && !String(error?.message || '').toLowerCase().includes('not found')) {
        throw error;
      }
    }

    logger.info('Creating Qdrant collection', { collectionName });
    await this.withQdrantRetry('Qdrant createCollection', () => this.qdrant.createCollection(collectionName, {
      vectors: {
        size: 384,
        distance: 'Cosine',
      },
    }));

    const indexSpecs = [
      { field_name: 'text_hash', field_schema: 'keyword' as const },
      { field_name: 'created_at', field_schema: 'integer' as const },
      { field_name: 'expires_at', field_schema: 'integer' as const },
      { field_name: 'owner_id', field_schema: 'keyword' as const },
      { field_name: 'user_id', field_schema: 'keyword' as const },
      { field_name: 'document_id', field_schema: 'keyword' as const },
    ];

    for (const spec of indexSpecs) {
      try {
        await this.withQdrantRetry(`Qdrant createPayloadIndex:${spec.field_name}`, () =>
          this.qdrant.createPayloadIndex(collectionName, spec as any)
        );
      } catch (error: any) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('already exists')) continue;
        throw error;
      }
    }
  }

  private async clearChunkRows(documentId: string, ownerId: string): Promise<void> {
    const strategies: Array<(query: any) => any> = [
      (query) => query.eq('owner_id', ownerId),
      (query) => query.eq('user_id', ownerId),
      (query) => query,
    ];

    let lastError: any = null;
    for (const apply of strategies) {
      const query = this.supabase
        .from('au_document_chunks')
        .delete()
        .eq('document_id', documentId);
      apply(query);
      const { error } = await query;
      if (!error) return;

      if (this.isMissingTableError(error)) {
        throw new Error(
          'Missing table public.au_document_chunks. Apply worker pipeline migrations before running ingestion.'
        );
      }
      if (
        this.isMissingColumnError(error, 'owner_id') ||
        this.isMissingColumnError(error, 'user_id')
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }

    if (lastError) throw lastError;
  }

  private async insertChunkRows(rows: ChunkRow[]): Promise<void> {
    const variants: ChunkRow[][] = [
      rows,
      rows.map(({ owner_id, ...rest }) => ({ ...rest })),
      rows.map(({ user_id, ...rest }) => ({ ...rest })),
      rows.map(({ owner_id, user_id, ...rest }) => ({ ...rest })),
    ];

    let lastError: any = null;
    for (const variant of variants) {
      let variantError: any = null;
      for (let start = 0; start < variant.length; start += this.chunkInsertBatchSize) {
        const batch = variant.slice(start, start + this.chunkInsertBatchSize);
        const { error } = await this.supabase
          .from('au_document_chunks')
          .insert(batch as any[]);
        if (error) {
          variantError = error;
          break;
        }
      }

      if (!variantError) {
        return;
      }

      if (this.isMissingTableError(variantError)) {
        throw new Error(
          'Missing table public.au_document_chunks. Apply worker pipeline migrations before running ingestion.'
        );
      }

      if (
        this.isMissingColumnError(variantError, 'owner_id') ||
        this.isMissingColumnError(variantError, 'user_id')
      ) {
        lastError = variantError;
        continue;
      }

      throw variantError;
    }

    if (lastError) throw lastError;
  }

  private async countChunkRows(documentId: string, ownerId: string): Promise<number> {
    const strategies: Array<(query: any) => any> = [
      (query) => query.eq('owner_id', ownerId),
      (query) => query.eq('user_id', ownerId),
      (query) => query,
    ];

    let lastError: any = null;
    for (const apply of strategies) {
      const query = this.supabase
        .from('au_document_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId);
      apply(query);
      const { count, error } = await query;
      if (!error) return Number(count || 0);

      if (this.isMissingTableError(error)) {
        throw new Error(
          'Missing table public.au_document_chunks. Apply worker pipeline migrations before running ingestion.'
        );
      }
      if (
        this.isMissingColumnError(error, 'owner_id') ||
        this.isMissingColumnError(error, 'user_id')
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }

    if (lastError) throw lastError;
    return 0;
  }

  private async embedTexts(model: FlagEmbedding, texts: string[]): Promise<number[][]> {
    const embeddingResult: any = model.embed(texts);
    const embeddings: number[][] = [];

    if (embeddingResult && typeof embeddingResult[Symbol.asyncIterator] === 'function') {
      for await (const batch of embeddingResult) {
        embeddings.push(...(batch as number[][]));
      }
    } else {
      const resolved = await embeddingResult;
      embeddings.push(...(resolved as number[][]));
    }

    return embeddings;
  }

  /**
   * Upserts chunks into Qdrant and verifies chunk/vector integrity.
   */
  async processDocument(
    documentId: string,
    chunks: string[],
    ownerId: string,
    expiresAt: number
  ): Promise<void> {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new Error('Cannot process empty chunk list');
    }

    const startedAt = Date.now();
    logger.info('Processing document', { documentId, ownerId, chunkCount: chunks.length, expiresAt });
    const collectionName = 'au_chunks';
    await this.ensureCollection(collectionName);

    const chunkData = chunks.map((text, index) => ({
      id: this.stablePointId(ownerId, documentId, index),
      text,
      hash: computeHash(text),
      index,
    }));

    const createdAt = Math.floor(Date.now() / 1000);

    await this.clearChunkRows(documentId, ownerId);
    const chunkRows: ChunkRow[] = chunkData.map((chunk) => ({
      id: chunk.id,
      document_id: documentId,
      owner_id: ownerId,
      user_id: ownerId,
      chunk_index: chunk.index,
      text: chunk.text,
    }));
    await this.insertChunkRows(chunkRows);

    const dbChunkCount = await this.countChunkRows(documentId, ownerId);
    if (dbChunkCount !== chunkData.length) {
      throw new Error(`Chunk row mismatch: expected ${chunkData.length}, got ${dbChunkCount}`);
    }

    try {
      await this.withQdrantRetry('Qdrant delete preflight', () =>
        this.qdrant.delete(collectionName, {
          filter: this.ownerFilter(documentId, ownerId),
        })
      );
    } catch (error) {
      logger.warn('Qdrant delete preflight failed, continuing with deterministic IDs', {
        documentId,
        ownerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const model = await this.getModel();
    let upserted = 0;
    for (let start = 0; start < chunkData.length; start += this.embedBatchSize) {
      const batch = chunkData.slice(start, start + this.embedBatchSize);
      const embeddings = await this.embedTexts(model, batch.map((chunk) => chunk.text));

      if (embeddings.length !== batch.length) {
        throw new Error(`Embedding count mismatch in batch: expected ${batch.length}, got ${embeddings.length}`);
      }

      const points = batch.map((chunk, idx) => {
        const vector = Array.from(embeddings[idx] || []);
        if (vector.length !== 384) {
          throw new Error(`Embedding dimension mismatch for chunk ${chunk.index}: expected 384, got ${vector.length}`);
        }

        return {
          id: chunk.id,
          vector,
          payload: {
            chunk_id: chunk.id,
            document_id: documentId,
            user_id: ownerId,
            owner_id: ownerId,
            chunk_index: chunk.index,
            text: chunk.text,
            text_hash: chunk.hash,
            created_at: createdAt,
            expires_at: expiresAt,
            metadata: {
              pipeline: this.pipelineId,
              processed_at: new Date().toISOString(),
            },
          },
        };
      });

      await this.withQdrantRetry('Qdrant upsert', () =>
        this.qdrant.upsert(collectionName, { wait: true, points })
      );

      upserted += points.length;
    }

    const countRes = await this.withQdrantRetry('Qdrant verification count', () =>
      this.qdrant.count(collectionName, {
        filter: this.ownerFilter(documentId, ownerId),
        exact: true,
      } as any)
    );

    const storedCount = Number((countRes as any)?.count ?? -1);
    if (!Number.isFinite(storedCount) || storedCount !== chunkData.length) {
      throw new Error(`Qdrant stored count mismatch: expected ${chunkData.length}, got ${storedCount}`);
    }

    const documentUpdate = await this.supabase
      .from('au_documents')
      .update({
        status: 'completed',
        error: null,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      })
      .eq('id', documentId);

    if (documentUpdate.error) {
      throw documentUpdate.error;
    }

    logger.info('Document ingestion completed', {
      documentId,
      ownerId,
      chunkCount: chunkData.length,
      upserted,
      durationMs: Date.now() - startedAt,
    });
  }

  private stablePointId(ownerId: string, documentId: string, chunkIndex: number): string {
    const input = `${ownerId}:${documentId}:${chunkIndex}`;
    const hex = createHash('sha256').update(input).digest('hex').slice(0, 32);
    const b = hex.split('');
    b[12] = '4';
    b[16] = ['8', '9', 'a', 'b'][parseInt(b[16], 16) % 4];
    return `${b.slice(0, 8).join('')}-${b.slice(8, 12).join('')}-${b.slice(12, 16).join('')}-${b.slice(16, 20).join('')}-${b.slice(20, 32).join('')}`;
  }

  /**
   * Deletes all vectors associated with a document ID.
   */
  async deleteDocument(documentId: string, ownerId?: string): Promise<void> {
    const collectionName = 'au_chunks';
    logger.info('Deleting document vectors from Qdrant', { documentId, ownerId: ownerId || null });
    try {
      await this.withQdrantRetry('Qdrant getCollection', () => this.qdrant.getCollection(collectionName));
      await this.withQdrantRetry('Qdrant delete', () =>
        this.qdrant.delete(collectionName, {
          filter: ownerId
            ? this.ownerFilter(documentId, ownerId)
            : {
              must: [
                { key: 'document_id', match: { value: documentId } },
              ],
            },
        })
      );
      logger.info(`Vectors deleted for document ${documentId}`);
    } catch (error: any) {
      if (Number(error?.status) === 404) {
        logger.info(`Collection ${collectionName} not found, skipping deletion.`);
        return;
      }
      logger.error(`Failed to delete document ${documentId} from Qdrant`, error);
      // Do not throw: storage/db cleanup should continue.
    }
  }
}
