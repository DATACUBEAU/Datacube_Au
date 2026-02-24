
import { supabase, invokeEdgeFunction, getEffectiveOwnershipConditions, applyOwnershipFilter } from '@/lib/supabase-client/client';
import { safeFetch } from './safe-fetch';
import type { AuDocumentRow, AuDocumentType } from '@/lib/au/types';
import type { User } from '@supabase/supabase-js';
import { clearDocWorkingMemory } from '@/lib/memory/working-memory';
import { deleteMemorySummary } from '@/lib/api/memory-summaries';

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

function isAbortLikeError(error: unknown): boolean {
  const name = String((error as any)?.name || '');
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    name === 'AbortError' ||
    message.includes('aborterror') ||
    message.includes('signal is aborted') ||
    message.includes('aborted without reason')
  );
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
    metadata?: any;
  },
  accessToken?: string
): Promise<{ ok: boolean; uploadUrl: string; documentId: string; path: string; token?: string; bucket?: string; contentType?: string }> {
  const { data, error } = await invokeEdgeFunction('document-upload', {
    method: 'POST',
    requireAuth: true,
    body: {
      action: 'initiate',
      ...metadata
    }
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
  const { data, error } = await invokeEdgeFunction('document-upload', {
    method: 'POST',
    requireAuth: true,
    body: {
      action: 'complete',
      ...metadata
    }
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
 * Lists documents for the current user.
 * Mirrors RLS: USING (auth.uid() = user_id)
 */
export async function listDocuments(user: User | null): Promise<AuDocumentRow[]> {
  const conditions = await getEffectiveOwnershipConditions(user);

  const query = supabase
    .from('au_documents')
    .select('*');
  
  applyOwnershipFilter(query, conditions);
  
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    if (!isAbortLikeError(error)) {
      console.error('[API] Error listing documents:', error);
    }
    throw error;
  }
  return data || [];
}

/**
 * Deletes a document and its associated data.
 * Calls the document-management Edge Function which handles RLS-safe deletion.
 */
export async function deleteDocument(user: User | null, documentId: string): Promise<{ ok: boolean }> {
  // 1. Clear Local Memory & Server Memory Summary
  if (user?.id) {
    try {
      await clearDocWorkingMemory(user.id, documentId);
      await deleteMemorySummary({ scope: 'doc', docId: documentId });
    } catch (e) {
      console.warn('[deleteDocument] Memory cleanup warning:', e);
    }
  }

  const { data, error } = await invokeEdgeFunction('document-management', {
    method: 'POST',
    requireAuth: true,
    body: {
      action: 'delete',
      documentId
    }
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
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
