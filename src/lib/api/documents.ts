import type { User } from '@supabase/supabase-js';
import type { AuDocumentRow, AuDocumentType } from '@/lib/au/types';

export type { AuDocumentRow, AuDocumentType };

const localOnlyError = (operation: string) =>
  Object.assign(
    new Error(`${operation} is now handled locally by the AU app. Cloud document storage and processing have been retired.`),
    { status: 410, code: 'DOCUMENTS_ARE_LOCAL' },
  );

/**
 * Legacy cloud-upload API. Retained temporarily for compatibility with callers,
 * but it must never upload document bytes or create server-side document records.
 */
export async function initiateUpload(
  _user: User | null,
  _metadata: {
    fileName: string;
    fileSize: number;
    documentType: string;
    jobId: string;
    uploadId?: string;
    correlationId?: string;
    documentId: string;
    parentId?: string;
    parentDocumentId?: string;
    metadata?: unknown;
  },
  _accessToken?: string,
): Promise<{ ok: boolean; uploadUrl: string; documentId: string; path: string; token?: string; bucket?: string; contentType?: string }> {
  throw localOnlyError('Document upload');
}

export async function completeUpload(
  _user: User | null,
  _metadata: {
    documentId: string;
    jobId: string;
    uploadId?: string;
    correlationId?: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    path?: string;
    bucket?: string;
    metadata?: unknown;
  },
  _accessToken?: string,
): Promise<{ ok: boolean; jobId: string }> {
  throw localOnlyError('Document ingestion');
}

/** @deprecated Use the device-local document manager. */
export async function uploadDocument(
  _user: User | null,
  _metadata: unknown,
  _accessToken?: string,
): Promise<{ ok: boolean; jobId: string }> {
  throw localOnlyError('Document upload');
}

export async function listDocuments(_user: User | null): Promise<AuDocumentRow[]> {
  throw localOnlyError('Cloud document listing');
}

export async function deleteDocument(
  _user: User | null,
  _documentId: string,
): Promise<{ ok: boolean }> {
  throw localOnlyError('Cloud document deletion');
}

export async function getDocumentText(
  _user: User | null,
  _documentId: string,
  _limit = 15,
): Promise<string> {
  throw localOnlyError('Cloud document text retrieval');
}
