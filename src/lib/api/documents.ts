import { supabase, getEffectiveOwnershipConditions, decodeJWT, applyOwnershipFilter, getGuestToken } from '@/lib/supabase/client';
import { safeFetch } from './safe-fetch';
import type { AuDocumentRow, AuDocumentType } from '@/lib/au/types';
import type { User } from '@supabase/supabase-js';

export type { AuDocumentRow, AuDocumentType };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not defined in environment variables.");
}

/**
 * Uploads a document using the Edge Function with fallback to direct storage/DB operations.
 */
export async function uploadDocument(
  user: User | null,
  formData: FormData,
  accessToken?: string
): Promise<{ ok: boolean; jobId: string }> {
  const url = `${SUPABASE_URL}/functions/v1/document-upload`;
  
  // Prepare headers
  const headers: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY || '',
  };
  if (accessToken && accessToken !== 'undefined') {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    // 1. Try the Edge Function with safeFetch
    const res = await safeFetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    return res;
  } catch (error: any) {
    // If it's a deployment error or network error, we might still want fallback, 
    // but the user's instructions prioritize the "enqueue only" flow via the function.
    console.error('[API] document-upload failed:', error);
    throw error;
  }
}

const SAFE_DOC_COLUMNS = 'id, user_id, file_name, file_path, document_type, status, created_at, expires_at, parent_id, error';

/**
 * Lists documents for the current user or guest session.
 * Mirrors RLS: USING (auth.uid() = user_id OR guest_session_id = ...)
 */
export async function listDocuments(user: User | null): Promise<AuDocumentRow[]> {
  const conditions = await getEffectiveOwnershipConditions(user);

  const query = supabase
    .from('au_documents')
    .select(SAFE_DOC_COLUMNS);
  
  const filteredQuery = applyOwnershipFilter(query, conditions);
  
  let { data, error } = await filteredQuery.order('created_at', { ascending: false });

  if (error) {
    const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    const errorCode = error.code || 'unknown';

    console.error('[API] Error listing documents:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      fullError: error
    });

    // Fallback logic if guest_session_id column is missing
    if (errorMsg.includes('guest_session_id') || errorCode === '42703') {
      console.warn('[API] Missing guest_session_id or columns in au_documents, retrying safe');
      const retryConditions = conditions
        .split(',')
        .filter(c => !c.startsWith('guest_session_id'))
        .join(',') || 'id.eq.00000000-0000-0000-0000-000000000000';

      const retryQuery = supabase
        .from('au_documents')
        .select(SAFE_DOC_COLUMNS)
        .order('created_at', { ascending: false });
      
      applyOwnershipFilter(retryQuery, retryConditions);
      const { data: retryData, error: retryError } = await retryQuery;
      
      if (!retryError) {
        data = retryData;
        error = null;
      }
    }
  }

  if (error) {
    throw error;
  }

  return (data || []) as unknown as AuDocumentRow[];
}

/**
 * Deletes a document and its associated data.
 * Calls the document-management Edge Function which handles RLS-safe deletion.
 */
export async function deleteDocument(user: User | null, documentId: string): Promise<{ ok: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  const guestToken = getGuestToken();
  const accessToken = session?.access_token || guestToken || undefined;

  const url = `${SUPABASE_URL}/functions/v1/document-management`;
  
  const headers: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY || '',
    'Content-Type': 'application/json',
  };
  if (accessToken && accessToken !== 'undefined') {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  return await safeFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'delete',
      documentId
    }),
  });
}

/**
 * Helper to apply ownership filters consistently
 */
function applyOwnershipFilters(query: any, conditions: string) {
  return applyOwnershipFilter(query, conditions);
}

/**
 * Fetches all text chunks for a document and joins them.
 */
export async function getDocumentText(user: User | null, documentId: string): Promise<string> {
  const conditions = await getEffectiveOwnershipConditions(user);

  const query = supabase
    .from('au_document_chunks')
    .select('text')
    .eq('document_id', documentId);

  applyOwnershipFilter(query, conditions);

  const { data, error } = await query.order('chunk_index', { ascending: true });

  if (error) {
    console.error('[API] Error fetching document text:', error);
    throw error;
  }

  return (data || []).map(chunk => chunk.text).join('\n\n');
}
