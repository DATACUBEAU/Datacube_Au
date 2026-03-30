import { supabase, getEffectiveOwnershipConditions, applyOwnershipFilter } from '@/lib/supabase-client/client';
import type { AuDocumentChunkRow, AuDocumentRow } from '@/lib/au/types';
import type { User } from '@supabase/supabase-js';
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import {
  normalizeAuDocumentRow,
  normalizeAuDocumentType,
  resolveDocumentRetentionDays,
} from '@/lib/au/document-normalization';

export const SAFE_DOC_COLUMNS = 'id, owner_id, user_id, file_name, file_path, document_type, status, created_at, expires_at, parent_id, parent_document_id, error';
const DOC_TEXT_CACHE_ROUTE = '/dashboard/documents/chunks';
const DOC_TEXT_CACHE_SOURCE = 'au_document_chunks';
const DOC_TEXT_CACHE_SCHEMA = 1;
const DOC_TEXT_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const DOC_TEXT_MEMORY_TTL_MS = 60_000;
const docTextMemoryCache = new Map<string, { text: string; cachedAt: number }>();
const docTextInFlightRequests = new Map<string, Promise<string>>();

function isMissingColumnError(error: unknown, column: string): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  const details = String((error as any)?.details || '').toLowerCase();
  const lowered = column.toLowerCase();
  return (
    (message.includes(lowered) && message.includes('does not exist')) ||
    (details.includes(lowered) && details.includes('does not exist'))
  );
}

async function getOwnershipConditionCandidates(user: User | null): Promise<string[]> {
  const fallback = await getEffectiveOwnershipConditions(user);
  if (!user?.id) return [fallback];

  const conditions = [
    `owner_id.eq.${user.id},user_id.eq.${user.id}`,
    `owner_id.eq.${user.id}`,
    `user_id.eq.${user.id}`,
    fallback,
  ];
  return Array.from(new Set(conditions.filter(Boolean)));
}

export async function listAuDocumentsForUser(user: User | null) {
  const ownershipConditions = await getOwnershipConditionCandidates(user);
  const retentionDays = await resolveDocumentRetentionDays(user?.id ?? null);

  for (const conditions of ownershipConditions) {
    const query = supabase
      .from('au_documents')
      .select(SAFE_DOC_COLUMNS);

    applyOwnershipFilter(query, conditions);
    const { data, error } = await query.order('created_at', { ascending: false });

    if (!error) {
      return (data ?? []).map((row) => normalizeAuDocumentRow(row, retentionDays, user?.id ?? null));
    }

    if (isMissingColumnError(error, 'owner_id') && conditions.includes('owner_id')) {
      continue;
    }

    console.error('[documents] Error listing documents (final):', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      fullError: error
    });
    throw error;
  }

  return [];
}

export async function listCompletedAuDocumentsForUser(user: User | null, documentType?: AuDocumentRow['document_type']) {
  const ownershipConditions = await getOwnershipConditionCandidates(user);
  const normalizedType = documentType ? normalizeAuDocumentType(documentType) : null;
  const retentionDays = await resolveDocumentRetentionDays(user?.id ?? null);

  for (const conditions of ownershipConditions) {
    const query = supabase
      .from('au_documents')
      .select(SAFE_DOC_COLUMNS)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (normalizedType) {
      query.eq('document_type', normalizedType);
    }

    applyOwnershipFilter(query, conditions);
    const { data, error } = await query;

    if (!error) {
      return (data ?? []).map((row) => normalizeAuDocumentRow(row, retentionDays, user?.id ?? null));
    }

    if (isMissingColumnError(error, 'owner_id') && conditions.includes('owner_id')) {
      continue;
    }

    console.error('[documents] Error listing completed documents:', error);
    throw error;
  }

  return [];
}

export async function getAuDocumentChunksText(user: User | null, documentId: string): Promise<string> {
  const cacheKey = user?.id ? `${user.id}:${documentId}` : documentId;
  const readCachedText = async () => {
    const memoryCached = docTextMemoryCache.get(cacheKey);
    if (memoryCached && Date.now() - memoryCached.cachedAt < DOC_TEXT_MEMORY_TTL_MS) {
      return memoryCached.text;
    }
    if (!user?.id) return '';
    const cached = await readUserCache<{ text?: string }>({
      userId: user.id,
      route: DOC_TEXT_CACHE_ROUTE,
      source: DOC_TEXT_CACHE_SOURCE,
      endpoint: 'get',
      query: { documentId },
      schemaVersion: DOC_TEXT_CACHE_SCHEMA,
      maxAgeMs: DOC_TEXT_CACHE_TTL_MS,
    });
    return typeof cached.data?.text === 'string' ? cached.data.text : '';
  };

  const writeCachedText = async (text: string) => {
    if (!user?.id || !text) return;
    docTextMemoryCache.set(cacheKey, { text, cachedAt: Date.now() });
    await writeUserCache({
      userId: user.id,
      route: DOC_TEXT_CACHE_ROUTE,
      source: DOC_TEXT_CACHE_SOURCE,
      endpoint: 'get',
      query: { documentId },
      schemaVersion: DOC_TEXT_CACHE_SCHEMA,
      ttlMs: DOC_TEXT_CACHE_TTL_MS,
      data: { text },
    });
  };

  const browserOffline =
    typeof window !== 'undefined' &&
    (
      window.navigator.onLine === false ||
      (window as any).__DCAU_NETWORK_STATE?.state === 'offline'
    );

  if (browserOffline) {
    return readCachedText();
  }

  const memoryCached = docTextMemoryCache.get(cacheKey);
  if (memoryCached && Date.now() - memoryCached.cachedAt < DOC_TEXT_MEMORY_TTL_MS) {
    return memoryCached.text;
  }

  const existingRequest = docTextInFlightRequests.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const ownershipConditions = await getOwnershipConditionCandidates(user);
  const request = (async () => {
    for (const conditions of ownershipConditions) {
      const query = supabase
        .from('au_document_chunks')
        .select('text, chunk_index')
        .eq('document_id', documentId)
        .order('chunk_index', { ascending: true });

      applyOwnershipFilter(query, conditions);
      const { data, error } = await query;

      if (!error) {
        const rows = (data ?? []) as Pick<AuDocumentChunkRow, 'text' | 'chunk_index'>[];
        const text = rows.map(r => r.text).join('\n\n');
        void writeCachedText(text);
        return text;
      }

      if (isMissingColumnError(error, 'owner_id') && conditions.includes('owner_id')) {
        continue;
      }

      console.error('[documents] Error getting document chunks:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        fullError: error
      });
      const cachedText = await readCachedText();
      if (cachedText) return cachedText;
      throw error;
    }

    return readCachedText();
  })().finally(() => {
    docTextInFlightRequests.delete(cacheKey);
  });

  docTextInFlightRequests.set(cacheKey, request);
  return request;
}

export async function countPastQuestionsForParent(user: User | null, parentId: string): Promise<number> {
  const ownershipConditions = await getOwnershipConditionCandidates(user);

  for (const conditions of ownershipConditions) {
    const query = supabase
      .from('au_documents')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parentId)
      .eq('document_type', 'past_questions');

    applyOwnershipFilter(query, conditions);
    const { count, error } = await query;

    if (!error) {
      return count ?? 0;
    }

    if (isMissingColumnError(error, 'owner_id') && conditions.includes('owner_id')) {
      continue;
    }

    console.error('[documents] Error counting past questions:', error);
    break;
  }

  return 0;
}
