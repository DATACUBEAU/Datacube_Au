import { supabase, getEffectiveOwnershipConditions, applyOwnershipFilter } from '@/lib/supabase-client/client';
import type { AuDocumentChunkRow, AuDocumentRow } from '@/lib/au/types';
import type { User } from '@supabase/supabase-js';

const SAFE_DOC_COLUMNS = 'id, user_id, file_name, file_path, document_type, status, created_at, expires_at, parent_id, error';

export async function listAuDocumentsForUser(user: User | null) {
  const conditions = await getEffectiveOwnershipConditions(user);
  
  const query = supabase
    .from('au_documents')
    .select(SAFE_DOC_COLUMNS);
    
  applyOwnershipFilter(query, conditions);

  let { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    const errorCode = error.code || 'unknown';
    
    // Log detailed error for debugging
    console.error('[documents] Error listing documents:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      fullError: error
    });

    if (errorCode === '42703') {
      const retryQuery = supabase
        .from('au_documents')
        .select(SAFE_DOC_COLUMNS)
        .order('created_at', { ascending: false });
      
      applyOwnershipFilter(retryQuery, conditions);
      const { data: retryData, error: retryError } = await retryQuery;
      
      if (!retryError) {
        data = retryData;
        error = null;
      }
    }
  }

  if (error) {
    console.error('[documents] Error listing documents (final):', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      fullError: error
    });
    throw error;
  }
  
  return (data ?? []) as unknown as AuDocumentRow[];
}

export async function listCompletedAuDocumentsForUser(user: User | null, documentType?: AuDocumentRow['document_type']) {
  const conditions = await getEffectiveOwnershipConditions(user);
  
  const buildQuery = (conds: string, columns = SAFE_DOC_COLUMNS) => {
    const q = supabase
      .from('au_documents')
      .select(columns);
    
    applyOwnershipFilter(q, conds);
    
    const finalQ = q
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (documentType) return finalQ.eq('document_type', documentType);
    return finalQ;
  };

  let { data, error } = await buildQuery(conditions);
  
  if (error) {
    const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    const errorCode = error.code || 'unknown';
    
    console.error('[documents] Error listing completed documents:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      fullError: error
    });

    if (errorCode === '42703') {
      const { data: retryData, error: retryError } = await buildQuery(conditions);
      if (!retryError) {
        data = retryData;
        error = null;
      }
    }
  }

  if (error) {
    console.error('[documents] Error listing completed documents:', error);
    throw error;
  }
  
  return (data ?? []) as unknown as AuDocumentRow[];
}

export async function getAuDocumentChunksText(user: User | null, documentId: string): Promise<string> {
  const conditions = await getEffectiveOwnershipConditions(user);
  
  const query = supabase
    .from('au_document_chunks')
    .select('text, chunk_index')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true });

  applyOwnershipFilter(query, conditions);
  let { data, error } = await query;

  if (error) {
    const errorCode = error.code || 'unknown';

    if (errorCode === '42703') {
      const retryQuery = supabase
        .from('au_document_chunks')
        .select('text, chunk_index')
        .eq('document_id', documentId)
        .order('chunk_index', { ascending: true });

      applyOwnershipFilter(retryQuery, conditions);
      const { data: retryData, error: retryError } = await retryQuery;
      
      if (!retryError) {
        data = retryData;
        error = null;
      } else {
        console.error('[documents] Retry failed:', retryError.message);
      }
    }
  }

  if (error) {
    console.error('[documents] Error getting document chunks:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      fullError: error
    });
    throw error;
  }
  
  const rows = (data ?? []) as Pick<AuDocumentChunkRow, 'text' | 'chunk_index'>[];
  return rows.map(r => r.text).join('\n\n');
}

export async function countPastQuestionsForParent(user: User | null, parentId: string): Promise<number> {
  const conditions = await getEffectiveOwnershipConditions(user);
  
  const buildCountQuery = (conds: string) => {
    const q = supabase
      .from('au_documents')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parentId)
      .eq('document_type', 'past_questions');
    
    applyOwnershipFilter(q, conds);
    return q;
  };

  let { count, error } = await buildCountQuery(conditions);

  if (error) {
    if (error.code === '42703') {
      const { count: retryCount, error: retryError } = await buildCountQuery(conditions);
      if (!retryError) {
        count = retryCount;
        error = null;
      }
    }
  }

  if (error) {
    console.error('[documents] Error counting past questions:', error);
    return 0;
  }
  
  return count ?? 0;
}
