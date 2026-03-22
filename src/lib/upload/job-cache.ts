import { readUserCache, writeUserCache } from '../cache/user-cache';
import type { UploadJobRow, UploadJobStatus } from './types';

const UPLOAD_JOB_CACHE_ROUTE = '/dashboard/documents/uploads';
const UPLOAD_JOB_CACHE_SOURCE = 'upload-jobs-provider';
const UPLOAD_JOB_CACHE_SCHEMA = 1;
const UPLOAD_JOB_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const TERMINAL_STATUSES = new Set<UploadJobStatus>([
  'completed',
  'done',
  'failed',
  'cancelled',
  'stale_timeout',
  'deleting',
]);

const VALID_UPLOAD_STATUSES = new Set<UploadJobStatus>([
  'queued',
  'uploading',
  'uploaded',
  'processing',
  'completed',
  'done',
  'failed',
  'cancelled',
  'stale_timeout',
  'deleting',
]);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNullableString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized || null;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUploadStatus(value: unknown): UploadJobStatus {
  const status = asString(value).toLowerCase() as UploadJobStatus;
  return VALID_UPLOAD_STATUSES.has(status) ? status : 'queued';
}

function normalizeIsoDate(value: unknown): string {
  const normalized = asString(value);
  if (!normalized) return new Date(0).toISOString();
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

export function normalizePersistedUploadJobs(value: unknown, userId: string): UploadJobRow[] {
  const source = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray((value as any).jobs) ? (value as any).jobs : []);

  const normalized = source
    .map((entry: unknown) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      if (!row) return null;

      const id = asString(row.id);
      const documentId = asString(row.document_id);
      const fileName = asString(row.file_name);
      if (!id || !documentId || !fileName) return null;

      const ownerId = asNullableString(row.owner_id) || asNullableString(row.user_id) || userId;
      const rowUserId = asNullableString(row.user_id) || ownerId || userId;
      if (ownerId !== userId && rowUserId !== userId) return null;

      return {
        id,
        upload_id: asNullableString(row.upload_id),
        user_id: rowUserId,
        owner_id: ownerId,
        document_id: documentId,
        document_type: (asNullableString(row.document_type) as UploadJobRow['document_type']) ?? null,
        parent_id: asNullableString(row.parent_id),
        label: asNullableString(row.label),
        file_name: fileName,
        mime_type: asNullableString(row.mime_type),
        file_size_bytes: Math.max(0, Math.floor(asNumber(row.file_size_bytes, 0))),
        bucket: asString(row.bucket) || 'documents',
        object_path: asString(row.object_path),
        status: normalizeUploadStatus(row.status),
        progress: Math.max(0, Math.min(100, Math.floor(asNumber(row.progress, 0)))),
        tus_url: asNullableString(row.tus_url),
        error: asNullableString(row.error),
        created_at: normalizeIsoDate(row.created_at),
        updated_at: normalizeIsoDate(row.updated_at),
      } satisfies UploadJobRow;
    })
    .filter((row: UploadJobRow | null): row is UploadJobRow => row !== null);

  const deduped = new Map<string, UploadJobRow>();
  for (const row of normalized) {
    const existing = deduped.get(row.id);
    if (!existing || Date.parse(row.updated_at) >= Date.parse(existing.updated_at)) {
      deduped.set(row.id, row);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function serializePersistedUploadJobs(jobs: UploadJobRow[]): { jobs: UploadJobRow[] } {
  return {
    jobs: jobs
      .map((job: UploadJobRow) => ({
        ...job,
        error: job.error ?? null,
        label: job.label ?? null,
        mime_type: job.mime_type ?? null,
        owner_id: job.owner_id ?? job.user_id ?? null,
        parent_id: job.parent_id ?? null,
        tus_url: job.tus_url ?? null,
        user_id: job.user_id ?? job.owner_id ?? null,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

export function shouldPersistUploadJob(job: UploadJobRow): boolean {
  if (!job?.id) return false;
  if (!job.user_id && !job.owner_id) return false;
  if (TERMINAL_STATUSES.has(job.status)) {
    return Boolean(job.error) || job.status === 'deleting';
  }
  return true;
}

export async function readCachedUploadJobs(userId: string): Promise<{
  jobs: UploadJobRow[];
  cachedAt: number | null;
}> {
  const cached = await readUserCache<{ jobs?: unknown }>({
    userId,
    route: UPLOAD_JOB_CACHE_ROUTE,
    source: UPLOAD_JOB_CACHE_SOURCE,
    endpoint: 'list',
    schemaVersion: UPLOAD_JOB_CACHE_SCHEMA,
    maxAgeMs: UPLOAD_JOB_CACHE_TTL_MS,
  });

  return {
    jobs: normalizePersistedUploadJobs(cached.data, userId),
    cachedAt: cached.cachedAt,
  };
}

export async function writeCachedUploadJobs(userId: string, jobs: UploadJobRow[]): Promise<void> {
  await writeUserCache({
    userId,
    route: UPLOAD_JOB_CACHE_ROUTE,
    source: UPLOAD_JOB_CACHE_SOURCE,
    endpoint: 'list',
    schemaVersion: UPLOAD_JOB_CACHE_SCHEMA,
    ttlMs: UPLOAD_JOB_CACHE_TTL_MS,
    data: serializePersistedUploadJobs(jobs.filter(shouldPersistUploadJob)),
  });
}
