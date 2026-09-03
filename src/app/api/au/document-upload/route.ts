import { NextRequest, NextResponse } from 'next/server';
import {
  EffectiveLimitError,
  resolveCanonicalEffectiveLimits,
  throwIngestLimitIfNeeded,
  throwUploadLimitIfNeeded,
} from '@/lib/server/au-limits';
import {
  accessControlResponse,
  isAccessControlError,
  requireEntitlement,
} from '@/lib/server/authorization';
import type { AuthorizedRequest } from '@/lib/server/authorization';
import {
  computeUploadExpiryFromPlan,
  resolveDocumentRetentionDays,
  resolveDocumentRetentionTier,
  RETENTION_POLICY_VERSION,
} from '@/lib/server/retention-policy';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const DEFAULT_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';

function jsonNoStore(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private');
  return NextResponse.json(body, { ...init, headers });
}

/**
 * Local document upload handler — replaces the deleted /api/proxy/document-upload.
 *
 * Handles two actions:
 *   - initiate: validates limits, creates signed upload URL, registers document row
 *   - complete: marks upload as complete, creates a worker job for RAG processing
 *
 * COLUMN MAPPING (verified against production migrations):
 *   au_documents:    id, user_id, owner_id, file_name, file_path, file_size_bytes,
 *                    document_type, status, parent_id, parent_document_id,
 *                    bucket, created_at, expires_at, error, content_hash,
 *                    cleanup_pending, storage_deleted_at, source_deleted_at
 *
 *   au_worker_jobs:  id, user_id, owner_id, document_id, upload_id, correlation_id,
 *                    file_name, mime_type, file_size_bytes, bucket, object_path,
 *                    status, progress, worker_id, metadata,
 *                    created_at, updated_at
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const correlationId = req.headers.get('x-correlation-id') || requestId;

  try {
    const authorization = await requireEntitlement(req, 'document_upload');

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim();

    if (action === 'initiate') {
      return await handleInitiate(authorization, body, requestId, correlationId);
    } else if (action === 'complete') {
      return await handleComplete(authorization, body, requestId, correlationId);
    } else {
      return jsonNoStore(
        { error: 'invalid_action', message: `Unknown action: ${action}`, requestId },
        { status: 400 },
      );
    }
  } catch (error: any) {
    if (isAccessControlError(error)) {
      return accessControlResponse(error, requestId);
    }
    if (error instanceof EffectiveLimitError) {
      return jsonNoStore(error.payload, {
        status: error.status,
        headers: error.headers,
      });
    }
    console.error(`[document-upload] Unhandled error:`, {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      requestId,
    });
    const status = error?.status || 500;
    const code = error?.code || 'upload_failed';
    return jsonNoStore(
      { error: code, message: String(error?.message || 'Upload failed.'), requestId },
      { status },
    );
  }
}

async function handleInitiate(authorization: AuthorizedRequest, body: any, requestId: string, correlationId: string) {
  const supabase = authorization.supabase;
  const userId = authorization.auth.userId;

  const fileName = String(body.fileName || '').trim();
  const fileSize = Number(body.fileSize || 0);
  const documentType = String(body.documentType || 'textbook').trim();
  const documentId = String(body.documentId || randomUUID()).trim();
  const parentId = body.parentId || null;
  const parentDocumentId = body.parentDocumentId || null;

  if (!fileName) {
    return jsonNoStore(
      { error: 'missing_filename', message: 'File name is required.', requestId },
      { status: 400 },
    );
  }

  const limitsResult = await resolveCanonicalEffectiveLimits({ supabase, userId });
  throwUploadLimitIfNeeded({
    limits: limitsResult,
    fileSizeBytes: fileSize,
    correlationId,
  });

  const bucket = DEFAULT_BUCKET;
  const ext = fileName.includes('.') ? fileName.split('.').pop() : 'pdf';
  const storagePath = `uploads/${userId}/${documentId}/${randomUUID()}.${ext}`;

  const { data: signedData, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);

  if (signedError) {
    console.error('[document-upload] Signed URL error:', {
      message: signedError.message,
      bucket,
      storagePath,
      requestId,
    });
    return jsonNoStore(
      {
        error: 'signed_url_failed',
        message: `Failed to create upload URL: ${signedError.message}`,
        requestId,
      },
      { status: 500 },
    );
  }

  const createdAt = new Date().toISOString();
  const uploadExpiresAt = parentId || parentDocumentId
    ? null
    : computeUploadExpiryFromPlan({
        createdAt,
        plan: limitsResult.effectivePlan.plan,
        entitlementSource: limitsResult.effectivePlan.entitlementSource,
      });
  const uploadRetentionTier = parentId || parentDocumentId
    ? null
    : resolveDocumentRetentionTier({
        plan: limitsResult.effectivePlan.plan,
        entitlementSource: limitsResult.effectivePlan.entitlementSource,
      });
  const uploadRetentionDays = parentId || parentDocumentId
    ? null
    : resolveDocumentRetentionDays({
        plan: limitsResult.effectivePlan.plan,
        entitlementSource: limitsResult.effectivePlan.entitlementSource,
      });
  const insertPayload: Record<string, any> = {
    id: documentId,
    user_id: userId,
    owner_id: userId,
    file_name: fileName,
    file_path: storagePath,
    file_size_bytes: fileSize,
    document_type: documentType,
    bucket,
    status: 'uploading',
    created_at: createdAt,
  };
  if (uploadExpiresAt) {
    insertPayload.expires_at = uploadExpiresAt;
    insertPayload.retention_granted_at = createdAt;
    insertPayload.retention_expires_at = uploadExpiresAt;
    insertPayload.retention_tier = uploadRetentionTier;
    insertPayload.retention_days = uploadRetentionDays;
    insertPayload.retention_policy_version = RETENTION_POLICY_VERSION;
  }

  if (parentId) {
    insertPayload.parent_id = parentId;
  }
  if (parentDocumentId) {
    insertPayload.parent_document_id = parentDocumentId;
  }

  const { error: insertError } = await supabase.from('au_documents').upsert(insertPayload, { onConflict: 'id' });

  if (insertError) {
    console.error('[document-upload] Document insert error:', {
      message: insertError.message,
      code: insertError.code,
      details: insertError.details,
      hint: insertError.hint,
      requestId,
    });

    const isParentTriggerError =
      insertError.message?.includes('parent_document') ||
      insertError.code === '22023';

    if (isParentTriggerError && (parentId || parentDocumentId)) {
      console.warn('[document-upload] Retrying insert without parent_id due to trigger error');
      delete insertPayload.parent_id;
      delete insertPayload.parent_document_id;
      const { error: retryError } = await supabase.from('au_documents').upsert(insertPayload, { onConflict: 'id' });
      if (retryError) {
        console.error('[document-upload] Retry insert also failed:', {
          message: retryError.message,
          code: retryError.code,
          requestId,
        });
        return jsonNoStore(
          {
            error: 'insert_failed',
            message: `Failed to register document: ${retryError.message}`,
            requestId,
          },
          { status: 500 },
        );
      }
    } else {
      return jsonNoStore(
        {
          error: 'insert_failed',
          message: `Failed to register document: ${insertError.message}`,
          requestId,
        },
        { status: 500 },
      );
    }
  }

  return jsonNoStore({
    ok: true,
    uploadUrl: signedData.signedUrl,
    documentId,
    path: storagePath,
    token: signedData.token,
    bucket,
    requestId,
  });
}

async function handleComplete(authorization: AuthorizedRequest, body: any, requestId: string, correlationId: string) {
  const supabase = authorization.supabase;
  const userId = authorization.auth.userId;

  const documentId = String(body.documentId || '').trim();
  const jobId = String(body.jobId || randomUUID()).trim();
  const uploadId = String(body.uploadId || body.jobId || jobId).trim();
  const mimeType = String(body.mimeType || 'application/pdf').trim();

  if (!documentId) {
    return jsonNoStore(
      { error: 'missing_document_id', message: 'Document ID is required.', requestId },
      { status: 400 },
    );
  }

  const limitsResult = await resolveCanonicalEffectiveLimits({ supabase, userId });
  throwIngestLimitIfNeeded({ limits: limitsResult, correlationId });

  // Never trust the client to choose the storage object at completion time.
  // The upload-initiation step already persisted the canonical owner-bound
  // bucket/path. Re-read that row and use it as the only worker source.
  const { data: ownedDocument, error: documentError } = await supabase
    .from('au_documents')
    .select('id,file_name,file_path,file_size_bytes,bucket')
    .eq('id', documentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (documentError) {
    console.error('[document-upload] Document lookup error:', {
      message: documentError.message,
      code: documentError.code,
      requestId,
    });
    return jsonNoStore(
      { error: 'document_lookup_failed', message: 'Unable to verify the uploaded document.', requestId },
      { status: 500 },
    );
  }

  if (!ownedDocument) {
    return jsonNoStore(
      { error: 'document_not_found', message: 'Uploaded document was not found.', requestId },
      { status: 404 },
    );
  }

  const objectPath = String(ownedDocument.file_path || '').trim();
  const bucket = String(ownedDocument.bucket || DEFAULT_BUCKET).trim();
  const expectedPrefix = `uploads/${userId}/${documentId}/`;

  if (!objectPath || !objectPath.startsWith(expectedPrefix) || bucket !== DEFAULT_BUCKET) {
    console.warn('[document-upload] Rejected non-canonical document storage location', {
      documentId,
      userId,
      bucket,
      requestId,
    });
    return jsonNoStore(
      {
        error: 'invalid_document_storage',
        message: 'The uploaded document storage reference is invalid. Start the upload again.',
        requestId,
      },
      { status: 409 },
    );
  }

  const fileName = String(ownedDocument.file_name || '').trim();
  const fileSize = Number(ownedDocument.file_size_bytes || 0);

  const { error: updateError } = await supabase
    .from('au_documents')
    .update({
      status: 'uploaded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('user_id', userId);

  if (updateError) {
    console.error('[document-upload] Document update error:', {
      message: updateError.message,
      code: updateError.code,
      requestId,
    });
    return jsonNoStore(
      { error: 'document_update_failed', message: 'Unable to finalize the uploaded document.', requestId },
      { status: 500 },
    );
  }

  const { error: jobError } = await supabase.from('au_worker_jobs').upsert({
    id: jobId,
    upload_id: uploadId,
    user_id: userId,
    owner_id: userId,
    document_id: documentId,
    status: 'queued',
    progress: 0,
    file_name: fileName,
    file_size_bytes: fileSize,
    mime_type: mimeType,
    object_path: objectPath,
    bucket,
    correlation_id: correlationId,
    worker_id: 'vps-worker',
    metadata: JSON.stringify({ requestId }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (jobError) {
    console.error('[document-upload] Worker job insert error:', {
      message: jobError.message,
      code: jobError.code,
      details: jobError.details,
      hint: jobError.hint,
      requestId,
    });
    return jsonNoStore(
      {
        error: 'job_creation_failed',
        message: `Failed to create processing job: ${jobError.message}`,
        requestId,
      },
      { status: 500 },
    );
  }

  return jsonNoStore({
    ok: true,
    jobId,
    documentId,
    requestId,
  });
}
