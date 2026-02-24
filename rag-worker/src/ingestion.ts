
import { SupabaseClient } from '@supabase/supabase-js';
import { Chunk } from './types';
import { logger, computeHash } from './utils';
import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

export class IngestionService {
  private embeddingModel?: FlagEmbedding;
  private qdrant: QdrantClient;
  private pipelineId: string;

  constructor(
    private supabase: SupabaseClient,
    qdrantUrl: string,
    qdrantApiKey?: string
  ) {
    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });
    this.pipelineId = process.env.WORKER_ID || process.env.PIPELINE_ID || 'vps-worker';
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

  /**
   * Upserts chunks into Qdrant (for search).
   * Applies deduplication and retention policy.
   */
  async processDocument(
    documentId: string,
    chunks: string[],
    ownerId: string,
    expiresAt: number
  ): Promise<void> {
    logger.info('Processing document', { documentId, chunkCount: chunks.length, expiresAt });
    const collectionName = 'au_chunks';

    // 1. Ensure collection exists
    try {
      await this.qdrant.getCollection(collectionName);
    } catch (e) {
      logger.info('Creating Qdrant collection', { collectionName });
      await this.qdrant.createCollection(collectionName, {
        vectors: {
          size: 384, // size for AllMiniLML6V2
          distance: 'Cosine',
        },
      });
      // Create Payload Index for hash and created_at for performance
      await this.qdrant.createPayloadIndex(collectionName, {
        field_name: 'text_hash',
        field_schema: 'keyword',
      });
      await this.qdrant.createPayloadIndex(collectionName, {
        field_name: 'created_at',
        field_schema: 'integer',
      });
      await this.qdrant.createPayloadIndex(collectionName, {
        field_name: 'expires_at',
        field_schema: 'integer',
      });
      await this.qdrant.createPayloadIndex(collectionName, {
        field_name: 'owner_id',
        field_schema: 'keyword',
      });
    }

    const chunkData = chunks.map((text, index) => ({
      id: this.stablePointId(ownerId, documentId, index),
      text,
      hash: computeHash(text),
      index,
    }));

    const createdAt = Math.floor(Date.now() / 1000);

    await this.supabase
      .from('au_document_chunks')
      .delete()
      .eq('document_id', documentId)
      .eq('owner_id', ownerId);

    const chunkRows = chunkData.map((c) => ({
      id: c.id,
      document_id: documentId,
      owner_id: ownerId,
      user_id: ownerId,
      chunk_index: c.index,
      text: c.text,
    }));

    const chunkInsert = await this.supabase
      .from('au_document_chunks')
      .insert(chunkRows);

    if (chunkInsert.error) {
      throw chunkInsert.error;
    }

    try {
      await this.qdrant.delete(collectionName, {
        filter: {
          must: [
            { key: 'document_id', match: { value: documentId } },
            { key: 'user_id', match: { value: ownerId } },
          ],
        },
      });
    } catch (err) {
      logger.warn('Qdrant delete preflight failed, continuing with upsert', err);
    }

    const model = await this.getModel();
    const embeddingResult: any = model.embed(chunkData.map((c) => c.text));
    const embeddings: number[][] = [];

    if (embeddingResult && typeof embeddingResult[Symbol.asyncIterator] === 'function') {
      for await (const batch of embeddingResult) {
        embeddings.push(...(batch as number[][]));
      }
    } else {
      const resolved = await embeddingResult;
      embeddings.push(...(resolved as number[][]));
    }

    if (embeddings.length !== chunkData.length) {
      throw new Error(`Embedding count mismatch: expected ${chunkData.length}, got ${embeddings.length}`);
    }

    const points = chunkData.map((chunk, i) => ({
      id: chunk.id,
      vector: Array.from(embeddings[i]),
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
    }));

    await this.qdrant.upsert(collectionName, { wait: true, points });

    try {
      const countRes = await this.qdrant.count(collectionName, {
        filter: {
          must: [
            { key: 'document_id', match: { value: documentId } },
            { key: 'user_id', match: { value: ownerId } },
          ],
        },
        exact: true,
      } as any);

      const storedCount = Number((countRes as any)?.count ?? 0);
      if (!Number.isFinite(storedCount) || storedCount < chunkData.length) {
        throw new Error(`Qdrant stored count mismatch: expected >=${chunkData.length}, got ${storedCount}`);
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Qdrant verification failed: ${message}`);
    }

    await this.supabase
      .from('au_documents')
      .update({
        status: 'completed',
        expires_at: new Date(expiresAt * 1000).toISOString(),
      })
      .eq('id', documentId);
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
  async deleteDocument(documentId: string): Promise<void> {
    const collectionName = 'au_chunks';
    logger.info(`Deleting document vectors from Qdrant`, { documentId });
    try {
        // Ensure collection exists before trying to delete
        await this.qdrant.getCollection(collectionName);
        
        await this.qdrant.delete(collectionName, {
            filter: {
                must: [
                    { key: 'document_id', match: { value: documentId } }
                ]
            }
        });
        logger.info(`Vectors deleted for document ${documentId}`);
    } catch (e: any) {
        if (e?.status === 404) {
             logger.info(`Collection ${collectionName} not found, skipping deletion.`);
             return;
        }
        logger.error(`Failed to delete document ${documentId} from Qdrant`, e);
        // Don't throw, we want to proceed with DB/Storage cleanup
    }
  }
}
