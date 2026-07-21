import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'crypto';
import { logger } from './utils';
import { finalizeDocumentSourceCleanup } from './source-cleanup';

type CompletedDocumentRow = {
  id: string;
  owner_id?: string | null;
  user_id?: string | null;
  file_path?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  storage_deleted_at?: string | null;
  source_deleted_at?: string | null;
};

type ChunkRow = {
  id: string;
  chunk_index: number;
  text: string;
};

function computeHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function stablePointId(ownerId: string, documentId: string, chunkIndex: number): string {
  const input = `${ownerId}:${documentId}:${chunkIndex}`;
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 32);
  const b = hex.split('');
  b[12] = '4';
  b[16] = ['8', '9', 'a', 'b'][parseInt(b[16], 16) % 4];
  return `${b.slice(0, 8).join('')}-${b.slice(8, 12).join('')}-${b.slice(12, 16).join('')}-${b.slice(16, 20).join('')}-${b.slice(20, 32).join('')}`;
}

function ownerFilter(documentId: string, ownerId: string) {
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

function asEpochSeconds(value: string | null | undefined): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function isInvalidPayloadText(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^0+$/.test(trimmed);
}

function normalizeVector(raw: any): number[] | null {
  if (Array.isArray(raw)) {
    const vector = raw.map((entry) => Number(entry));
    return vector.length > 0 ? vector : null;
  }

  if (raw && typeof raw === 'object') {
    const firstArray = Object.values(raw).find((entry) => Array.isArray(entry)) as any[] | undefined;
    if (firstArray) {
      const vector = firstArray.map((entry) => Number(entry));
      return vector.length > 0 ? vector : null;
    }
  }

  return null;
}

async function fetchCompletedDocuments(
  supabase: SupabaseClient,
  limit: number,
  documentId?: string,
): Promise<CompletedDocumentRow[]> {
  let query = supabase
    .from('au_documents')
    .select('id,owner_id,user_id,file_path,created_at,expires_at,storage_deleted_at,source_deleted_at')
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (documentId) {
    query = query.eq('id', documentId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as CompletedDocumentRow[];
}

async function fetchChunkRows(
  supabase: SupabaseClient,
  documentId: string,
  ownerId: string,
): Promise<ChunkRow[]> {
  const strategies: Array<(query: any) => any> = [
    (query) => query.eq('owner_id', ownerId),
    (query) => query.eq('user_id', ownerId),
    (query) => query,
  ];

  for (const apply of strategies) {
    const query = supabase
      .from('au_document_chunks')
      .select('id,chunk_index,text')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true });
    apply(query);
    const { data, error } = await query;
    if (!error) {
      return (data || []) as ChunkRow[];
    }

    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('owner_id') ||
      message.includes('user_id')
    ) {
      continue;
    }
    throw error;
  }

  return [];
}

async function fetchQdrantPoints(
  qdrant: QdrantClient,
  documentId: string,
  ownerId: string,
): Promise<any[]> {
  const points: any[] = [];
  let offset: any = undefined;

  while (true) {
    const result = await qdrant.scroll('au_chunks', {
      filter: ownerFilter(documentId, ownerId),
      with_payload: true,
      with_vector: true,
      limit: 256,
      offset,
    } as any);

    const batch = Array.isArray((result as any)?.points) ? (result as any).points : [];
    points.push(...batch);
    offset = (result as any)?.next_page_offset;
    if (!offset || batch.length === 0) break;
  }

  return points;
}

async function repairDocumentPayloads(input: {
  qdrant: QdrantClient;
  doc: CompletedDocumentRow;
  ownerId: string;
  chunks: ChunkRow[];
  points: any[];
}): Promise<{ repaired: number; skippedMissingVector: number }> {
  const createdAtFallback = asEpochSeconds(input.doc.created_at) ?? Math.floor(Date.now() / 1000);
  const expiresAtFallback = asEpochSeconds(input.doc.expires_at);

  const pointByChunkIndex = new Map<number, any>();
  for (const point of input.points) {
    const chunkIndex = Number(point?.payload?.chunk_index);
    if (Number.isFinite(chunkIndex) && !pointByChunkIndex.has(chunkIndex)) {
      pointByChunkIndex.set(chunkIndex, point);
    }
  }

  const correctedPoints: any[] = [];
  let skippedMissingVector = 0;

  for (const chunk of input.chunks) {
    const expectedText = String(chunk.text || '');
    if (isInvalidPayloadText(expectedText)) {
      logger.warn('Skipping invalid source chunk text in Supabase during repair', {
        documentId: input.doc.id,
        chunkIndex: chunk.chunk_index,
      });
      continue;
    }

    const expectedHash = computeHash(expectedText);
    const existingPoint = pointByChunkIndex.get(Number(chunk.chunk_index));
    if (!existingPoint) {
      continue;
    }

    const existingPayload = existingPoint?.payload || {};
    const payloadText = existingPayload.text;
    const payloadHash = String(existingPayload.text_hash || '').trim();
    const payloadDocumentId = String(existingPayload.document_id || '').trim();

    const needsRepair =
      isInvalidPayloadText(payloadText) ||
      String(payloadText) !== expectedText ||
      payloadHash !== expectedHash ||
      payloadDocumentId !== input.doc.id;

    if (!needsRepair) {
      continue;
    }

    const vector = normalizeVector(existingPoint?.vector);
    if (!vector || vector.length !== 384) {
      skippedMissingVector += 1;
      continue;
    }

    const pointId = String(existingPoint?.id || stablePointId(input.ownerId, input.doc.id, Number(chunk.chunk_index))).trim();
    if (!pointId) {
      skippedMissingVector += 1;
      continue;
    }

    correctedPoints.push({
      id: pointId,
      vector,
      payload: {
        ...existingPayload,
        chunk_id: pointId,
        document_id: input.doc.id,
        owner_id: input.ownerId,
        user_id: input.ownerId,
        chunk_index: Number(chunk.chunk_index),
        text: expectedText,
        text_hash: expectedHash,
        created_at: Number(existingPayload.created_at || createdAtFallback),
        ...(expiresAtFallback ? { expires_at: expiresAtFallback } : {}),
      },
    });
  }

  if (correctedPoints.length > 0) {
    for (let start = 0; start < correctedPoints.length; start += 64) {
      const batch = correctedPoints.slice(start, start + 64);
      await input.qdrant.upsert('au_chunks', { wait: true, points: batch });
    }
  }

  return {
    repaired: correctedPoints.length,
    skippedMissingVector,
  };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;

  if (!supabaseUrl || !supabaseServiceKey || !qdrantUrl) {
    throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or QDRANT_URL');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const qdrant = new QdrantClient({
    url: qdrantUrl,
    apiKey: qdrantApiKey,
    checkCompatibility: false,
  });

  const limit = Math.max(1, Number(process.env.REPAIR_COMPLETED_DOC_LIMIT || 200));
  const documentIdFilter = String(process.env.REPAIR_DOCUMENT_ID || '').trim() || undefined;
  const defaultBucket = process.env.BUCKET || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';

  const docs = await fetchCompletedDocuments(supabase, limit, documentIdFilter);
  logger.info('Starting ingestion repair run', {
    documents: docs.length,
    limit,
    documentIdFilter: documentIdFilter || null,
  });

  let sourceCleanupFixed = 0;
  let payloadRepairedPoints = 0;
  let payloadRepairSkippedMissingVector = 0;

  for (const doc of docs) {
    const ownerId = String(doc.owner_id || doc.user_id || '').trim();
    if (!ownerId) {
      logger.warn('Skipping completed document without owner_id/user_id', { documentId: doc.id });
      continue;
    }

    if (!doc.source_deleted_at && !doc.storage_deleted_at) {
      const cleanup = await finalizeDocumentSourceCleanup({
        supabase,
        documentId: doc.id,
        preferredObjectPath: String(doc.file_path || '').trim() || null,
        expectedOwnerId: ownerId,
        defaultBucket,
      });
      if (cleanup.success) {
        sourceCleanupFixed += 1;
      } else {
        logger.warn('Source cleanup repair failed', {
          documentId: doc.id,
          cleanupCode: cleanup.code,
          cleanupError: cleanup.error,
        });
      }
    }

    const chunks = await fetchChunkRows(supabase, doc.id, ownerId);
    if (chunks.length === 0) continue;

    const points = await fetchQdrantPoints(qdrant, doc.id, ownerId);
    if (points.length === 0) continue;

    const repaired = await repairDocumentPayloads({
      qdrant,
      doc,
      ownerId,
      chunks,
      points,
    });

    payloadRepairedPoints += repaired.repaired;
    payloadRepairSkippedMissingVector += repaired.skippedMissingVector;
    if (repaired.repaired > 0) {
      logger.info('Repaired Qdrant payload text mismatches', {
        documentId: doc.id,
        repairedPoints: repaired.repaired,
        skippedMissingVector: repaired.skippedMissingVector,
      });
    }
  }

  logger.info('Ingestion repair completed', {
    documentsScanned: docs.length,
    sourceCleanupFixed,
    payloadRepairedPoints,
    payloadRepairSkippedMissingVector,
  });
}

main().catch((error) => {
  logger.error('Ingestion repair crashed', error);
  process.exit(1);
});
