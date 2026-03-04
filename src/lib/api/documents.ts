
import { supabase, invokeEdgeFunction, getEffectiveOwnershipConditions, applyOwnershipFilter } from '@/lib/supabase-client/client';
import type { AuDocumentRow, AuDocumentType } from '@/lib/au/types';
import type { User } from '@supabase/supabase-js';
import { clearDocWorkingMemory } from '@/lib/memory/working-memory';
import { deleteMemorySummary } from '@/lib/api/memory-summaries';
import { normalizeAuDocumentRow, resolveDocumentRetentionDays } from '@/lib/au/document-normalization';

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

function extractApiErrorCode(error: any): string | null {
  const direct = typeof error?.code === 'string' ? error.code : null;
  const details = error?.details;
  let parsedDetails: any = null;
  if (typeof details === 'string') {
    try {
      parsedDetails = JSON.parse(details);
    } catch {
      parsedDetails = null;
    }
  }
  const nested =
    typeof details?.code === 'string'
      ? details.code
      : typeof details?.details?.code === 'string'
        ? details.details.code
        : typeof details?.error?.code === 'string'
          ? details.error.code
          : typeof parsedDetails?.code === 'string'
            ? parsedDetails.code
            : typeof parsedDetails?.details?.code === 'string'
              ? parsedDetails.details.code
          : null;
  const code = (nested || direct || '').trim();
  return code || null;
}

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
    uploadId?: string;
    correlationId?: string;
    documentId: string;
    parentId?: string;
    parentDocumentId?: string;
    metadata?: any;
  },
  accessToken?: string
): Promise<{ ok: boolean; uploadUrl: string; documentId: string; path: string; token?: string; bucket?: string; contentType?: string }> {
  const { data, error } = await invokeEdgeFunction('document-upload', {
    method: 'POST',
    requireAuth: true,
    headers: metadata.correlationId ? { 'x-correlation-id': metadata.correlationId } : undefined,
    body: {
      action: 'initiate',
      ...metadata
    }
  });

  if (error) {
    const message = String(error?.message || 'Upload initiation failed');
    const wrapped = new Error(message);
    (wrapped as any).status = error?.status;
    (wrapped as any).code = extractApiErrorCode(error);
    (wrapped as any).details = error?.details || null;
    console.error('[API] initiateUpload error:', {
      status: (wrapped as any).status,
      code: (wrapped as any).code,
      message,
      details: (wrapped as any).details,
    });
    throw wrapped;
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
    uploadId?: string;
    correlationId?: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    path?: string;
    bucket?: string;
    metadata?: any;
  },
  accessToken?: string
): Promise<{ ok: boolean; jobId: string }> {
  const { data, error } = await invokeEdgeFunction('document-upload', {
    method: 'POST',
    requireAuth: true,
    headers: metadata.correlationId ? { 'x-correlation-id': metadata.correlationId } : undefined,
    body: {
      action: 'complete',
      ...metadata
    }
  });

  if (error) {
    const message = String(error?.message || 'Upload completion failed');
    const wrapped = new Error(message);
    (wrapped as any).status = error?.status;
    (wrapped as any).code = extractApiErrorCode(error);
    (wrapped as any).details = error?.details || null;
    console.error('[API] completeUpload error:', {
      status: (wrapped as any).status,
      code: (wrapped as any).code,
      message,
      details: (wrapped as any).details,
    });
    throw wrapped;
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
  const ownershipConditions = await getOwnershipConditionCandidates(user);
  const retentionDays = await resolveDocumentRetentionDays(user?.id ?? null);

  for (const conditions of ownershipConditions) {
    const query = supabase
      .from('au_documents')
      .select('*');

    applyOwnershipFilter(query, conditions);
    const { data, error } = await query.order('created_at', { ascending: false });

    if (!error) {
      const rows = (data || []).map((row) => normalizeAuDocumentRow(row, retentionDays, user?.id ?? null));
      return rows;
    }

    if (isAbortLikeError(error)) throw error;

    if (isMissingColumnError(error, 'owner_id') && conditions.includes('owner_id')) {
      continue;
    }
    if (!isAbortLikeError(error)) {
      console.error('[API] Error listing documents:', error);
    }
    throw error;
  }

  return [];
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
  const ownershipConditions = await getOwnershipConditionCandidates(user);

  for (const conditions of ownershipConditions) {
    const query = supabase
      .from('au_document_chunks')
      .select('text')
      .eq('document_id', documentId);

    applyOwnershipFilter(query, conditions);
    const { data, error } = await query.order('chunk_index', { ascending: true });

    if (!error) {
      return (data || []).map(chunk => chunk.text).join('\n\n');
    }

    if (isMissingColumnError(error, 'owner_id') && conditions.includes('owner_id')) {
      continue;
    }

    console.error('[API] Error fetching document text:', error);
    throw error;
  }

  return '';
}
