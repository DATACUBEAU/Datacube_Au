
import { SupabaseClient } from '@supabase/supabase-js';
import { Chunk } from './types';
import { logger, computeHash } from './utils';
import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'crypto';

export class IngestionService {
  private embeddingModel?: FlagEmbedding;
  private qdrant: QdrantClient;

  constructor(
    private supabase: SupabaseClient,
    qdrantUrl: string,
    qdrantApiKey?: string
  ) {
    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });
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

    // 2. Calculate Hashes & Deduplication
    const chunkData = chunks.map((text, index) => ({
      text,
      hash: computeHash(text),
      index
    }));

    const hashes = chunkData.map(c => c.hash);
    
    // Check for existing hashes to avoid re-embedding/storing
    // We scroll for any points with these hashes for this user
    const existingHashes = new Set<string>();
    
    // Batch check (simplified: if list is huge, might need pagination, but for docs < 100 pages it's fine)
    try {
       const searchResult = await this.qdrant.scroll(collectionName, {
         filter: {
           must: [
             { key: 'owner_id', match: { value: ownerId } },
             { key: 'text_hash', match: { any: hashes } }
           ]
         },
         with_payload: true,
         limit: hashes.length
       });
       
       searchResult.points.forEach(point => {
         if (point.payload && typeof point.payload.text_hash === 'string') {
           existingHashes.add(point.payload.text_hash);
         }
       });
    } catch (err) {
      logger.warn('Failed to check for duplicates, proceeding with full ingestion', err);
    }

    const newChunks = chunkData.filter(c => !existingHashes.has(c.hash));
    
    if (newChunks.length === 0) {
       logger.info('All chunks already exist. Skipping ingestion.');
    } else {
        logger.info(`Ingesting ${newChunks.length} new chunks (skipped ${chunkData.length - newChunks.length} duplicates)`);

        // 3. Generate Embeddings locally
        const model = await this.getModel();
        const embeddingResult: any = model.embed(newChunks.map((c) => c.text));
        const embeddings: number[][] = [];

        if (embeddingResult && typeof embeddingResult[Symbol.asyncIterator] === 'function') {
          for await (const batch of embeddingResult) {
            embeddings.push(...(batch as number[][]));
          }
        } else {
          const resolved = await embeddingResult;
          embeddings.push(...(resolved as number[][]));
        }

        // 4. Upsert to Qdrant
        const points = newChunks.map((chunk, i) => ({
          id: randomUUID(),
          vector: Array.from(embeddings[i]),
          payload: {
            document_id: documentId,
            text: chunk.text, // Text is already chunked to ~1000 chars in utils.ts
            owner_id: ownerId,
            text_hash: chunk.hash,
            created_at: Math.floor(Date.now() / 1000),
            expires_at: expiresAt,
            metadata: {
              source: 'vps-worker',
              processed_at: new Date().toISOString()
            }
          },
        }));

        await this.qdrant.upsert(collectionName, {
          wait: true,
          points,
        });
    }

    // 5. Update Supabase with success
    // We also update expires_at in DB to match
    await this.supabase
      .from('au_documents')
      .update({ 
          status: 'completed',
          expires_at: new Date(expiresAt * 1000).toISOString()
      })
      .eq('id', documentId);
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
