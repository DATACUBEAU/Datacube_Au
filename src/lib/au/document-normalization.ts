import type { AuDocumentRow, AuDocumentStatus, AuDocumentType } from '@/lib/au/types';

export const FREE_RETENTION_DAYS = 14;
export const PRO_RETENTION_DAYS = 14;

const RETENTION_CACHE_TTL_MS = 5 * 60 * 1000;
const retentionCache = new Map<string, { value: number; ts: number }>();

export function normalizeAuDocumentType(raw: unknown): AuDocumentType {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (
    value === 'past_questions' ||
    value === 'past_question' ||
    value === 'exam_questions' ||
    value === 'exam_question'
  ) {
    return value.startsWith('exam_') ? 'exam_questions' : 'past_questions';
  }

  if (
    value === 'main_textbook' ||
    value === 'main_textbooks' ||
    value === 'textbook' ||
    value === 'textbooks'
  ) {
    return 'main_textbook';
  }

  return 'main_textbook';
}

export function normalizeAuDocumentStatus(raw: unknown): AuDocumentStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'done' || value === 'indexed') return 'completed';
  if (value === 'queued' || value === 'pending_upload') return 'uploading';
  if (value === 'uploaded') return 'processing';
  if (value === 'failed') return 'failed';
  if (value === 'processing') return 'processing';
  if (value === 'completed') return 'completed';
  return 'uploading';
}

export function computeFallbackExpiresAt(createdAt: string | null | undefined, retentionDays: number): string | null {
  if (!createdAt) return null;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return null;
  const expiresMs = createdMs + retentionDays * 24 * 60 * 60 * 1000;
  return new Date(expiresMs).toISOString();
}

export async function resolveDocumentRetentionDays(userId: string | null | undefined): Promise<number> {
  const cacheKey = userId || '__default__';
  const cached = retentionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RETENTION_CACHE_TTL_MS) {
    return cached.value;
  }

  // Retention is governed by backend policy:
  // - 7 days signed-out cleanup for uploaded documents
  // - 14 days inactivity cleanup for documents + derived data.
  const retentionDays = FREE_RETENTION_DAYS;
  retentionCache.set(cacheKey, { value: retentionDays, ts: Date.now() });
  return retentionDays;
}

export function normalizeAuDocumentRow(row: any, retentionDays: number, fallbackOwnerId?: string | null): AuDocumentRow {
  const ownerId = row?.owner_id ?? row?.user_id ?? fallbackOwnerId ?? null;
  const expiresAt = row?.expires_at || computeFallbackExpiresAt(row?.created_at, retentionDays);

  return {
    ...row,
    owner_id: ownerId,
    user_id: row?.user_id ?? ownerId,
    document_type: normalizeAuDocumentType(row?.document_type),
    status: normalizeAuDocumentStatus(row?.status),
    expires_at: expiresAt,
    parent_id: row?.parent_id ?? null,
    parent_document_id: row?.parent_document_id ?? row?.parent_id ?? null,
    error: row?.error ?? null,
  } as AuDocumentRow;
}
