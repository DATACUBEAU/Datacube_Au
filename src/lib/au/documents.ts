import { supabase, getEffectiveOwnershipConditions, applyOwnershipFilter } from '@/lib/supabase-client/client';
import type { AuDocumentChunkRow, AuDocumentRow } from '@/lib/au/types';
import type { User } from '@supabase/supabase-js';
import {
  normalizeAuDocumentRow,
  normalizeAuDocumentType,
  resolveDocumentRetentionDays,
} from '@/lib/au/document-normalization';

const SAFE_DOC_COLUMNS = 'id, owner_id, user_id, file_name, file_path, document_type, status, created_at, expires_at, parent_id, error';

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
  const ownershipConditions = await getOwnershipConditionCandidates(user);

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
      return rows.map(r => r.text).join('\n\n');
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
    throw error;
  }

  return '';
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
