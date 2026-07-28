import { QdrantClient } from '@qdrant/js-client-rest';
import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { SupabaseClient } from '@supabase/supabase-js';
import { clampPositiveInt, logger, parsePositiveInt } from './utils.js';

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
  private collectionName = process.env.QDRANT_COLLECTION || 'au_chunks';
  private qdrantTimeoutMs = parsePositiveInt(process.env.QDRANT_TIMEOUT_MS, 8000);

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
        FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2 }).then((embedder: FlagEmbedding) => {
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
    const userId = String(params.userId || '').trim();
    const documentId = String(params.documentId || '').trim();
    const query = String(params.query || '').trim();
    if (!userId || !documentId || !query) {
      logger.warn('semanticTopKRetrieval: missing required retrieval filter/query, failing closed.', {
        hasUserId: Boolean(userId),
        hasDocumentId: Boolean(documentId),
        hasQuery: Boolean(query),
      });
      return [];
    }

    const limit = clampPositiveInt(params.limit, 15, 1, 20);
    const maxChars = clampPositiveInt(params.maxChars, 12000, 1000, 16000);
    
    const mustFilters: any[] = [
      { key: 'user_id', match: { value: userId } },
      { key: 'document_id', match: { value: documentId } },
    ];

    try {
      const vector = await this.embedQuery(query);
      const rawResults = await this.withTimeout<any[]>('qdrant semantic search', () =>
        this.qdrant.search(this.collectionName, {
          vector,
          filter: { must: mustFilters },
          limit,
          with_payload: true,
          score_threshold: params.minScore || 0.0,
        })
      );

      return this.processRawResults(rawResults, maxChars, { userId, documentId });
    } catch (err: any) {
      logger.error('semanticTopKRetrieval error', { message: err.message });
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
    const userId = String(params.userId || '').trim();
    const documentId = String(params.documentId || '').trim();
    if (!userId || !documentId) {
      logger.warn('boundedCoverageRetrieval: missing required retrieval filter, failing closed.', {
        hasUserId: Boolean(userId),
        hasDocumentId: Boolean(documentId),
      });
      return [];
    }

    const limit = clampPositiveInt(params.limit, 15, 1, 20);
    const maxChars = clampPositiveInt(params.maxChars, 12000, 1000, 16000);
    
    const mustFilters: any[] = [
      { key: 'user_id', match: { value: userId } },
      { key: 'document_id', match: { value: documentId } },
    ];

    let rawResults: any[] = [];
    let qdrantFailed = false;

    try {
      const scrollResult = await this.withTimeout<{ points: any[] }>('qdrant bounded scroll', () =>
        this.qdrant.scroll(this.collectionName, {
          filter: { must: mustFilters },
          limit: Math.min(8, Math.max(3, Math.floor(limit / 2))),
          with_payload: true,
          with_vector: false,
        })
      );
      rawResults.push(...scrollResult.points);

      const intentQueries = (params.intentQueries || [])
        .map((query) => String(query || '').trim())
        .filter(Boolean)
        .slice(0, 4);

      if (intentQueries.length > 0) {
        const queryPromises = intentQueries.map(async (query) => {
          try {
            const vector = await this.embedQuery(query);
            const searchResult = await this.withTimeout<any[]>('qdrant bounded intent search', () =>
              this.qdrant.search(this.collectionName, {
                vector,
                filter: { must: mustFilters },
                limit: Math.min(6, Math.max(2, Math.floor(limit / intentQueries.length))),
                with_payload: true,
              })
            );
            return searchResult;
          } catch (e: any) {
            logger.warn('Intent query failed', { message: e.message });
            return [];
          }
        });

        const intentResults = await Promise.all(queryPromises);
        for (const res of intentResults) {
          rawResults.push(...res);
        }
      }
    } catch (err: any) {
      logger.error('Qdrant retrieval failed in boundedCoverageRetrieval', { message: err.message });
      qdrantFailed = true;
    }

    let chunks = this.processRawResults(rawResults, maxChars, { userId, documentId });

    if (qdrantFailed || chunks.length === 0) {
       chunks = await this.fallbackSupabaseRetrieval(userId, documentId, limit, maxChars);
    }

    return chunks;
  }

  private processRawResults(rawResults: any[], maxChars: number, expected: { userId: string; documentId: string }): RetrievedChunk[] {
    const uniqueMap = new Map<string, RetrievedChunk>();
    
    for (const point of rawResults) {
      const payload = point.payload || {};
      const text = payload.text as string || '';
      const textHash = payload.text_hash as string || '';
      const idKey = textHash || String(point.id);
      const payloadDocumentId = String(payload.document_id || '').trim();
      const payloadUserId = String(payload.user_id || '').trim();
      const payloadOwnerId = String(payload.owner_id || '').trim();

      if (payloadDocumentId !== expected.documentId) continue;
      if (payloadUserId !== expected.userId && payloadOwnerId !== expected.userId) continue;

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

  private async fallbackSupabaseRetrieval(userId: string, documentId: string, limit: number, maxChars: number): Promise<RetrievedChunk[]> {
    if (!userId || !documentId) {
      logger.warn('fallbackSupabaseRetrieval: missing required retrieval filter, failing closed.');
      return [];
    }
    logger.warn('Invoking fallbackSupabaseRetrieval for bounded coverage');
    
    const strategies: Array<{ column: 'user_id' | 'owner_id' }> = [
      { column: 'user_id' },
      { column: 'owner_id' },
    ];

    for (const strategy of strategies) {
      const query = this.supabase
          .from('au_document_chunks')
          .select('id, document_id, chunk_index, text')
          .eq(strategy.column, userId)
          .eq('document_id', documentId)
          .order('chunk_index', { ascending: true })
          .limit(limit);

      const { data, error } = await query;
      if (!error && data) {
        return this.mapSupabaseData(data, maxChars, { userId, documentId });
      }

      if (error && error.message.includes(strategy.column)) {
        continue;
      }
      logger.error('fallbackSupabaseRetrieval failed', { message: error?.message });
      return [];
    }

    return [];
  }
  
  private mapSupabaseData(data: any[], maxChars: number, expected: { userId: string; documentId: string }) {
    const uniqueMap = new Map<string, RetrievedChunk>();
    for (const row of data) {
      if (String(row.document_id || '').trim() !== expected.documentId) continue;
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

  private async withTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout`)), this.qdrantTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
