import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './utils';

type DocumentCleanupSnapshot = {
  id: string;
  filePath: string | null;
  cleanupAttempts: number;
  storageDeletedAt: string | null;
  sourceDeletedAt: string | null;
};

type CleanupStateUpdate = {
  cleanup_pending: boolean;
  cleanup_attempts: number;
  cleanup_last_error: string | null;
  cleanup_last_attempt_at: string;
  storage_deleted_at?: string | null;
  source_deleted_at?: string | null;
  source_cleanup_result?: string | null;
};

export type SourceCleanupResultCode =
  | 'deleted'
  | 'already_missing'
  | 'already_deleted'
  | 'missing_path'
  | 'delete_failed';

export type SourceCleanupResult = {
  success: boolean;
  code: SourceCleanupResultCode;
  documentId: string;
  bucket: string;
  objectPath: string | null;
  attempts: number;
  deletedAt: string | null;
  error: string | null;
};

export type FinalizeSourceCleanupInput = {
  supabase: SupabaseClient;
  documentId: string;
  preferredBucket?: string | null;
  preferredObjectPath?: string | null;
  defaultBucket?: string | null;
};

function isMissingColumnError(error: any, column: string): boolean {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const target = column.toLowerCase();
  return (
    (message.includes(target) && message.includes('does not exist')) ||
    (details.includes(target) && details.includes('does not exist'))
  );
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'unknown_error';
  }
  const message = String(error || '').trim();
  if (!message || message === '{}' || message === '[]' || message === '[object Object]') {
    return 'unknown_error';
  }
  return message;
}

function parseStoragePath(objectPath: string): { folder: string; name: string } | null {
  const normalized = String(objectPath || '').trim().replace(/^\/+/, '');
  if (!normalized) return null;

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) {
    return { folder: '', name: normalized };
  }
  return {
    folder: normalized.slice(0, lastSlash),
    name: normalized.slice(lastSlash + 1),
  };
}

function isStorageMissingError(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes('no such file') ||
    message.includes('nosuchkey') ||
    message.includes('404')
  );
}

async function readCleanupSnapshot(
  supabase: SupabaseClient,
  documentId: string,
): Promise<DocumentCleanupSnapshot> {
  const baseColumns = 'id,file_path,cleanup_attempts,storage_deleted_at';
  const withSourceColumns = `${baseColumns},source_deleted_at`;

  let response = await supabase
    .from('au_documents')
    .select(withSourceColumns)
    .eq('id', documentId)
    .maybeSingle();

  if (response.error && isMissingColumnError(response.error, 'source_deleted_at')) {
    response = await supabase
      .from('au_documents')
      .select(baseColumns)
      .eq('id', documentId)
      .maybeSingle();
  }

  if (response.error) {
    throw response.error;
  }
  if (!response.data?.id) {
    throw new Error(`Document ${documentId} not found for source cleanup`);
  }

  return {
    id: String(response.data.id),
    filePath: String((response.data as any).file_path || '').trim() || null,
    cleanupAttempts: Number((response.data as any).cleanup_attempts || 0),
    storageDeletedAt: String((response.data as any).storage_deleted_at || '').trim() || null,
    sourceDeletedAt: String((response.data as any).source_deleted_at || '').trim() || null,
  };
}

async function updateCleanupStateWithFallback(
  supabase: SupabaseClient,
  documentId: string,
  payload: CleanupStateUpdate,
): Promise<void> {
  const mutablePayload: Record<string, unknown> = { ...payload };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await supabase
      .from('au_documents')
      .update(mutablePayload)
      .eq('id', documentId);

    if (!error) return;

    const removableColumns = ['source_deleted_at', 'source_cleanup_result', 'cleanup_last_attempt_at', 'cleanup_last_error'];
    let removedAny = false;
    for (const column of removableColumns) {
      if (Object.prototype.hasOwnProperty.call(mutablePayload, column) && isMissingColumnError(error, column)) {
        delete mutablePayload[column];
        removedAny = true;
      }
    }

    if (!removedAny) {
      throw error;
    }
  }
}

export async function markDocumentCleanupPending(input: {
  supabase: SupabaseClient;
  documentId: string;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload: CleanupStateUpdate = {
    cleanup_pending: true,
    cleanup_attempts: 0,
    cleanup_last_error: null,
    cleanup_last_attempt_at: nowIso,
    source_cleanup_result: 'pending',
  };

  try {
    await updateCleanupStateWithFallback(input.supabase, input.documentId, payload);
  } catch (error) {
    logger.warn('Failed to mark cleanup pending', {
      documentId: input.documentId,
      message: normalizeErrorMessage(error),
    });
  }
}

async function objectExistsInStorage(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<{ exists: boolean | null; error: string | null }> {
  const parsed = parseStoragePath(objectPath);
  if (!parsed) return { exists: null, error: 'invalid_object_path' };

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(parsed.folder, { search: parsed.name, limit: 20 });

  if (error) {
    return { exists: null, error: normalizeErrorMessage(error) };
  }

  const exists = Array.isArray(data) && data.some((entry: any) => String(entry?.name || '') === parsed.name);
  return { exists, error: null };
}

async function persistCleanupResult(input: {
  supabase: SupabaseClient;
  snapshot: DocumentCleanupSnapshot;
  success: boolean;
  code: SourceCleanupResultCode;
  error: string | null;
  deletedAt: string | null;
}): Promise<SourceCleanupResult> {
  const nowIso = new Date().toISOString();
  const attempts = Math.max(0, Number(input.snapshot.cleanupAttempts || 0)) + 1;
  const payload: CleanupStateUpdate = {
    cleanup_pending: !input.success,
    cleanup_attempts: attempts,
    cleanup_last_error: input.success ? null : (input.error || 'cleanup_failed'),
    cleanup_last_attempt_at: nowIso,
    source_cleanup_result: input.code,
    storage_deleted_at: input.success ? (input.deletedAt || nowIso) : input.snapshot.storageDeletedAt || null,
    source_deleted_at: input.success ? (input.deletedAt || nowIso) : input.snapshot.sourceDeletedAt || null,
  };

  await updateCleanupStateWithFallback(input.supabase, input.snapshot.id, payload);

  return {
    success: input.success,
    code: input.code,
    documentId: input.snapshot.id,
    bucket: '',
    objectPath: input.snapshot.filePath,
    attempts,
    deletedAt: input.success ? (input.deletedAt || nowIso) : (input.snapshot.sourceDeletedAt || input.snapshot.storageDeletedAt || null),
    error: input.success ? null : input.error,
  };
}

export async function finalizeDocumentSourceCleanup(
  input: FinalizeSourceCleanupInput,
): Promise<SourceCleanupResult> {
  const supabase = input.supabase;
  const snapshot = await readCleanupSnapshot(supabase, input.documentId);
  const bucket = String(input.preferredBucket || input.defaultBucket || 'documents').trim() || 'documents';
  const objectPath = String(snapshot.filePath || input.preferredObjectPath || '').trim() || null;

  if (snapshot.storageDeletedAt || snapshot.sourceDeletedAt) {
    const persisted = await persistCleanupResult({
      supabase,
      snapshot,
      success: true,
      code: 'already_deleted',
      error: null,
      deletedAt: snapshot.sourceDeletedAt || snapshot.storageDeletedAt,
    });
    return {
      ...persisted,
      bucket,
      objectPath,
    };
  }

  if (!objectPath) {
    const persisted = await persistCleanupResult({
      supabase,
      snapshot,
      success: false,
      code: 'missing_path',
      error: 'missing_source_path',
      deletedAt: null,
    });
    return {
      ...persisted,
      bucket,
      objectPath: null,
    };
  }

  const existenceCheck = await objectExistsInStorage(supabase, bucket, objectPath);
  if (existenceCheck.exists === false) {
    const nowIso = new Date().toISOString();
    const persisted = await persistCleanupResult({
      supabase,
      snapshot: { ...snapshot, filePath: objectPath },
      success: true,
      code: 'already_missing',
      error: null,
      deletedAt: nowIso,
    });
    return {
      ...persisted,
      bucket,
      objectPath,
    };
  }

  if (existenceCheck.error) {
    logger.warn('Source existence check failed before deletion; attempting delete anyway', {
      documentId: snapshot.id,
      bucket,
      objectPath,
      message: existenceCheck.error,
    });
  }

  const { error: removeError } = await supabase.storage
    .from(bucket)
    .remove([objectPath]);

  if (removeError) {
    if (isStorageMissingError(removeError)) {
      const nowIso = new Date().toISOString();
      const persisted = await persistCleanupResult({
        supabase,
        snapshot: { ...snapshot, filePath: objectPath },
        success: true,
        code: 'already_missing',
        error: null,
        deletedAt: nowIso,
      });
      return {
        ...persisted,
        bucket,
        objectPath,
      };
    }

    const message = normalizeErrorMessage(removeError);
    const persisted = await persistCleanupResult({
      supabase,
      snapshot: { ...snapshot, filePath: objectPath },
      success: false,
      code: 'delete_failed',
      error: message,
      deletedAt: null,
    });
    return {
      ...persisted,
      bucket,
      objectPath,
    };
  }

  const nowIso = new Date().toISOString();
  const persisted = await persistCleanupResult({
    supabase,
    snapshot: { ...snapshot, filePath: objectPath },
    success: true,
    code: 'deleted',
    error: null,
    deletedAt: nowIso,
  });

  return {
    ...persisted,
    bucket,
    objectPath,
  };
}
