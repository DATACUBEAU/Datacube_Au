import type { AuDocumentRow, AuDocumentStatus, AuDocumentType } from '@/lib/au/types';
import {
  FREE_PLAN_EXPIRATION_DAYS,
  PAID_PRO_PLAN_EXPIRATION_DAYS,
  resolvePlanExpirationDays,
} from '@/lib/plans/subscription-policy';
import {
  fetchCanonicalAccountSnapshotFromApi,
  resolveCanonicalAccountSnapshotClientFallback,
} from '@/lib/account/account-snapshot-client';

export const FREE_RETENTION_DAYS = FREE_PLAN_EXPIRATION_DAYS;
export const PRO_RETENTION_DAYS = PAID_PRO_PLAN_EXPIRATION_DAYS;

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

  let retentionDays = FREE_RETENTION_DAYS;

  if (userId && typeof window !== 'undefined' && typeof fetch === 'function') {
    const persisted = await resolveCanonicalAccountSnapshotClientFallback(userId);
    const persistedRetention = Number(persisted.snapshot?.entitlements?.retentionDays || 0);
    if (Number.isFinite(persistedRetention) && persistedRetention > 0) {
      retentionDays = Math.floor(persistedRetention);
    }

    try {
      const { response, snapshot: normalized } = await fetchCanonicalAccountSnapshotFromApi({
        userId,
        fetchImpl: fetch,
        useSafeFetch: false,
      });
      if (response.ok && normalized) {
        const explicitRetention = Number(normalized.entitlements.retentionDays);
        retentionDays =
          Number.isFinite(explicitRetention) && explicitRetention > 0
            ? Math.floor(explicitRetention)
            : resolvePlanExpirationDays({
                plan: normalized.entitlements.plan,
                entitlementSource: normalized.entitlements.entitlementSource,
              });
      }
    } catch {
      retentionDays =
        Number.isFinite(persistedRetention) && persistedRetention > 0
          ? Math.floor(persistedRetention)
          : retentionDays;
    }
  }

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
