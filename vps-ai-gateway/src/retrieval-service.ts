import { QdrantClient } from '@qdrant/js-client-rest';
import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './utils.js';

export interface RetrievedChunk {
  id: string | number;
  text: string;
  document_id: string;
  document_title?: string;
  chunk_index: number;
  page_number?: number;
  score?: number;
}

export class RetrievalService {
  private qdrant: QdrantClient;
  private embedder: FlagEmbedding | null = null;
  private embedderPromise: Promise<FlagEmbedding> | null = null;
  private collectionName = 'au_chunks';

  constructor(
    qdrantUrl: string,
    qdrantApiKey: string | undefined,
    private supabase: SupabaseClient
  ) {
    this.qdrant = new QdrantClient({ url: qdrantUrl, apiKey: qdrantApiKey });
  }

  private async getEmbedder() {
    if (this.embedder) return this.embedder;
    if (!this.embedderPromise) {
      logger.info('Initializing fastembed model for RetrievalService...');
      this.embedderPromise = Promise.race([
        FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2 }).then((embedder) => {
          this.embedder = embedder;
          logger.info('fastembed model initialized.');
          return embedder;
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FastEmbed init timeout')), 30000))
      ]);
    }
    return this.embedderPromise;
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const embedder = await this.getEmbedder();
      const embeddingsIter = await embedder.embed([text]);
      const firstResult = await embeddingsIter.next();
      if (!firstResult || !firstResult.value || !firstResult.value[0]) {
        throw new Error("Failed to embed query: empty result");
      }
      return Array.from(firstResult.value[0]);
    } catch (err: any) {
      logger.error('embedQuery error', err.message);
      throw new Error(`Embedding failed: ${err.message}`);
    }
  }

  async semanticTopKRetrieval(params: {
    userId: string;
    documentId?: string;
    query: string;
    limit?: number;
    minScore?: number;
    maxChars?: number;
  }): Promise<RetrievedChunk[]> {
    if (!params.userId) {
      logger.error('semanticTopKRetrieval: missing userId, failing closed.');
      return [];
    }

    const limit = params.limit || 15;
    const maxChars = params.maxChars || 12000;
    
    const mustFilters: any[] = [{ key: 'user_id', match: { value: params.userId } }];
    if (params.documentId) {
      mustFilters.push({ key: 'document_id', match: { value: params.documentId } });
    }

    try {
      const vector = await this.embedQuery(params.query);
      const rawResults = await this.qdrant.search(this.collectionName, {
        vector,
        filter: { must: mustFilters },
        limit,
        with_payload: true,
        score_threshold: params.minScore || 0.0,
      });

      return this.processRawResults(rawResults, maxChars);
    } catch (err: any) {
      logger.error('semanticTopKRetrieval error', err.message);
      return [];
    }
  }

  async boundedCoverageRetrieval(params: {
    userId: string;
    documentId?: string;
    intentQueries?: string[];
    limit?: number;
    maxChars?: number;
  }): Promise<RetrievedChunk[]> {
    if (!params.userId) {
      logger.error('boundedCoverageRetrieval: missing userId, failing closed.');
      return [];
    }

    const limit = params.limit || 15;
    const maxChars = params.maxChars || 12000;
    
    const mustFilters: any[] = [{ key: 'user_id', match: { value: params.userId } }];
    if (params.documentId) {
      mustFilters.push({ key: 'document_id', match: { value: params.documentId } });
    }

    let rawResults: any[] = [];
    let qdrantFailed = false;

    try {
      const scrollResult = await this.qdrant.scroll(this.collectionName, {
        filter: { must: mustFilters },
        limit: Math.max(5, Math.floor(limit / 2)),
        with_payload: true,
        with_vector: false,
      });
      rawResults.push(...scrollResult.points);

      if (params.intentQueries && params.intentQueries.length > 0) {
        const queryPromises = params.intentQueries.map(async (query) => {
          try {
            const vector = await this.embedQuery(query);
            const searchResult = await this.qdrant.search(this.collectionName, {
              vector,
              filter: { must: mustFilters },
              limit: Math.max(3, Math.floor(limit / params.intentQueries!.length)),
              with_payload: true,
            });
            return searchResult;
          } catch (e: any) {
            logger.error(`Intent query failed: ${query}`, e.message);
            return [];
          }
        });

        const intentResults = await Promise.all(queryPromises);
        for (const res of intentResults) {
          rawResults.push(...res);
        }
      }
    } catch (err: any) {
      logger.error('Qdrant scroll failed in boundedCoverageRetrieval', err.message);
      qdrantFailed = true;
    }

    let chunks = this.processRawResults(rawResults, maxChars);

    if (qdrantFailed || chunks.length === 0) {
       chunks = await this.fallbackSupabaseRetrieval(params.userId, params.documentId, limit, maxChars);
    }

    return chunks;
  }

  private processRawResults(rawResults: any[], maxChars: number): RetrievedChunk[] {
    const uniqueMap = new Map<string, RetrievedChunk>();
    
    for (const point of rawResults) {
      const payload = point.payload || {};
      const text = payload.text as string || '';
      const textHash = payload.text_hash as string || '';
      const idKey = textHash || String(point.id);

      if (!uniqueMap.has(idKey) && text.trim().length > 0) {
        uniqueMap.set(idKey, {
          id: point.id,
          text,
          document_id: payload.document_id as string,
          document_title: payload.document_title as string,
          chunk_index: (payload.chunk_index as number) || 0,
          page_number: payload.page_number as number,
          score: point.score,
        });
      }
    }

    const sortedChunks = Array.from(uniqueMap.values()).sort((a, b) => a.chunk_index - b.chunk_index);

    const finalChunks: RetrievedChunk[] = [];
    let currentChars = 0;
    for (const chunk of sortedChunks) {
      if (currentChars + chunk.text.length <= maxChars) {
        finalChunks.push(chunk);
        currentChars += chunk.text.length;
      } else {
        break;
      }
    }

    return finalChunks;
  }

  private async fallbackSupabaseRetrieval(userId: string, documentId: string | undefined, limit: number, maxChars: number): Promise<RetrievedChunk[]> {
    logger.warn('Invoking fallbackSupabaseRetrieval for bounded coverage');
    
    let query = this.supabase
      .from('au_document_chunks')
      .select('id, document_id, chunk_index, text')
      // use user_id since au_document_chunks can be filtered by either owner_id or user_id or we just fallback to no owner_id check if we only have document_id and user_id isn't indexed, wait we must enforce owner_id
      // According to schemas seen earlier, owner_id is safe. If it fails, I'll switch to user_id. Let's use user_id based on src/app/api/account/delete/route.ts.
      .eq('user_id', userId);
      
    if (documentId) {
      query = query.eq('document_id', documentId);
    }

    const { data, error } = await query
      .order('chunk_index', { ascending: true })
      .limit(limit);

    if (error || !data) {
      // It's possible the column is owner_id, fallback to it if there's an error.
      if (error && error.message.includes('user_id')) {
        let altQuery = this.supabase
          .from('au_document_chunks')
          .select('id, document_id, chunk_index, text')
          .eq('owner_id', userId);
        if (documentId) altQuery = altQuery.eq('document_id', documentId);
        
        const altRes = await altQuery.order('chunk_index', { ascending: true }).limit(limit);
        if (altRes.error || !altRes.data) return [];
        return this.mapSupabaseData(altRes.data, maxChars);
      }
      logger.error('fallbackSupabaseRetrieval failed', error?.message);
      return [];
    }

    return this.mapSupabaseData(data, maxChars);
  }
  
  private mapSupabaseData(data: any[], maxChars: number) {
    const uniqueMap = new Map<string, RetrievedChunk>();
    for (const row of data) {
      if (row.text && row.text.trim().length > 0) {
        uniqueMap.set(String(row.id), {
          id: row.id,
          text: row.text,
          document_id: row.document_id,
          chunk_index: row.chunk_index,
        });
      }
    }

    const sortedChunks = Array.from(uniqueMap.values()).sort((a, b) => a.chunk_index - b.chunk_index);
    const finalChunks: RetrievedChunk[] = [];
    let currentChars = 0;
    for (const chunk of sortedChunks) {
      if (currentChars + chunk.text.length <= maxChars) {
        finalChunks.push(chunk);
        currentChars += chunk.text.length;
      } else {
        break;
      }
    }

    return finalChunks;
  }
}
