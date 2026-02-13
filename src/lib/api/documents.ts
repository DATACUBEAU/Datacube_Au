
import { supabase, getEffectiveOwnershipConditions, decodeJWT, applyOwnershipFilter } from '@/lib/supabase-client/client';
import { safeFetch } from './safe-fetch';
import type { AuDocumentRow, AuDocumentType } from '@/lib/au/types';
import type { User } from '@supabase/supabase-js';

export type { AuDocumentRow, AuDocumentType };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  const errorMsg = "Configuration Error: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.";
  console.error(errorMsg);
  if (typeof window !== 'undefined') {
    throw new Error(errorMsg);
  }
}

/**
 * Initiates an upload: Validates limits and gets a Signed URL.
 */
export async function initiateUpload(
  user: User | null,
  metadata: {
    fileName: string;
    fileSize: number;
    documentType: string;
    jobId: string;
    documentId: string;
    parentId?: string;
    guestSessionId?: string;
    metadata?: any;
  },
  accessToken?: string
): Promise<{ ok: boolean; uploadUrl: string; documentId: string; path: string }> {
  const headers: Record<string, string> = {};
  if (accessToken && accessToken !== 'undefined') {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const { data, error } = await supabase.functions.invoke('document-upload', {
    body: {
      action: 'initiate',
      ...metadata
    },
    headers
  });

  if (error) {
    console.error('[API] initiateUpload error:', error);
    // Mimic the error object structure expected by callers if needed, or just throw
    throw error;
  }

  return data;
}

/**
 * Completes an upload: Registers the job for processing.
 */
export async function completeUpload(
  user: User | null,
  metadata: {
    documentId: string;
    jobId: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    metadata?: any;
  },
  accessToken?: string
): Promise<{ ok: boolean; jobId: string }> {
  const headers: Record<string, string> = {};
  if (accessToken && accessToken !== 'undefined') {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const { data, error } = await supabase.functions.invoke('document-upload', {
    body: {
      action: 'complete',
      ...metadata
    },
    headers
  });

  if (error) {
    console.error('[API] completeUpload error:', error);
    throw error;
  }

  return data;
}

/**
 * Legacy wrapper (Deprecated)
 */
export async function uploadDocument(
  user: User | null,
  metadata: any,
  accessToken?: string
): Promise<{ ok: boolean; jobId: string }> {
  console.error("uploadDocument is deprecated. Use initiateUpload/completeUpload.");
  throw new Error("Legacy upload flow not supported.");
}

/**
 * Lists documents for the current user or guest session.
 * Mirrors RLS: USING (auth.uid() = user_id OR guest_session_id = ...)
 */
export async function listDocuments(user: User | null): Promise<AuDocumentRow[]> {
  const conditions = await getEffectiveOwnershipConditions(user);

  const query = supabase
    .from('au_documents')
    .select('*');
  
  applyOwnershipFilter(query, conditions);
  
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.error('[API] Error listing documents:', error);
    throw error;
  }
  return data || [];
}

/**
 * Deletes a document and its associated data.
 * Calls the document-management Edge Function which handles RLS-safe deletion.
 */
export async function deleteDocument(user: User | null, documentId: string): Promise<{ ok: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null;
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
