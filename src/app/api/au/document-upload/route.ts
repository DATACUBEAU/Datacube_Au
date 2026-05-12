import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { resolveCanonicalEffectiveLimits } from '@/lib/server/au-limits';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const DEFAULT_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';

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
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Authentication required.', requestId },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim();

    if (action === 'initiate') {
      return await handleInitiate(auth, body, requestId, correlationId);
    } else if (action === 'complete') {
      return await handleComplete(auth, body, requestId, correlationId);
    } else {
      return NextResponse.json(
        { error: 'invalid_action', message: `Unknown action: ${action}`, requestId },
        { status: 400 },
      );
    }
  } catch (error: any) {
    console.error(`[document-upload] Unhandled error:`, {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      requestId,
    });
    const status = error?.status || 500;
    const code = error?.code || 'upload_failed';
    return NextResponse.json(
      { error: code, message: String(error?.message || 'Upload failed.'), requestId },
      { status },
    );
  }
}

async function handleInitiate(auth: any, body: any, requestId: string, correlationId: string) {
  const supabase = createSupabaseAdminClient();
  const userId = auth.userId;

  const fileName = String(body.fileName || '').trim();
  const fileSize = Number(body.fileSize || 0);
  const documentType = String(body.documentType || 'textbook').trim();
  const documentId = String(body.documentId || randomUUID()).trim();
  const parentId = body.parentId || null;
  const parentDocumentId = body.parentDocumentId || null;

  if (!fileName) {
    return NextResponse.json(
      { error: 'missing_filename', message: 'File name is required.', requestId },
      { status: 400 },
    );
  }

  // Check limits — wrapped in try/catch so limits infrastructure failures
  // don't block uploads entirely
  try {
    const limitsResult = await resolveCanonicalEffectiveLimits({ supabase, userId });
    const maxUploads = limitsResult.limitRules?.max_uploads_total?.value;
    const maxFileSize = limitsResult.limitRules?.max_file_size_mb?.value;

    if (maxFileSize && fileSize > maxFileSize * 1024 * 1024) {
      return NextResponse.json(
        {
          error: 'file_too_large',
          message: `File size exceeds ${maxFileSize}MB limit for your plan.`,
          details: { maxFileSize, fileSize },
          requestId,
        },
        { status: 413 },
      );
    }

    if (maxUploads) {
      const { count } = await supabase
        .from('au_documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (count != null && count >= maxUploads) {
        return NextResponse.json(
          {
            error: 'upload_limit_reached',
            message: `You have reached your upload limit of ${maxUploads} documents.`,
            details: { maxUploads, currentCount: count },
            requestId,
          },
          { status: 429 },
        );
      }
    }
  } catch (limitsErr: any) {
    // Log but don't block — limits tables may not exist yet
    console.warn('[document-upload] Limits check failed (non-blocking):', limitsErr?.message);
  }

  // Determine storage path and bucket
  const bucket = DEFAULT_BUCKET;
  const ext = fileName.includes('.') ? fileName.split('.').pop() : 'pdf';
  // Use a collision-safe path: uploads/userId/documentId/randomUUID.ext
  // This ensures every initiation attempt gets a fresh, unique path in storage.
  const storagePath = `uploads/${userId}/${documentId}/${randomUUID()}.${ext}`;

  // Create a signed upload URL
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
    return NextResponse.json(
      {
        error: 'signed_url_failed',
        message: `Failed to create upload URL: ${signedError.message}`,
        requestId,
      },
      { status: 500 },
    );
  }

  // Insert document row — columns MUST match au_documents schema exactly
  // Correct columns: file_path (not storage_path), file_size_bytes (not file_size)
  // DO NOT insert: correlation_id (not on au_documents), metadata (not on au_documents)
  const insertPayload: Record<string, any> = {
    id: documentId,
    user_id: userId,
    owner_id: userId,
    file_name: fileName,
    file_path: storagePath,        // ← correct column (not storage_path)
    file_size_bytes: fileSize,     // ← correct column (not file_size)
    document_type: documentType,
    bucket,
    status: 'uploading',
    created_at: new Date().toISOString(),
  };

  // Only set parent fields if provided — the inherit_attachment_expiry_from_parent
  // trigger requires the parent to exist AND have expires_at set.
  // For main documents, leave parent_id/parent_document_id as NULL.
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

    // If the trigger rejects due to parent_document_missing_expiry or parent_document_not_found,
    // retry without parent_id to avoid blocking uploads
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
        return NextResponse.json(
          {
            error: 'insert_failed',
            message: `Failed to register document: ${retryError.message}`,
            requestId,
          },
          { status: 500 },
        );
      }
    } else {
      return NextResponse.json(
        {
          error: 'insert_failed',
          message: `Failed to register document: ${insertError.message}`,
          requestId,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    uploadUrl: signedData.signedUrl,
    documentId,
    path: storagePath,
    token: signedData.token,
    bucket,
    requestId,
  });
}

async function handleComplete(auth: any, body: any, requestId: string, correlationId: string) {
  const supabase = createSupabaseAdminClient();
  const userId = auth.userId;

  const documentId = String(body.documentId || '').trim();
  const jobId = String(body.jobId || randomUUID()).trim();
  const uploadId = String(body.uploadId || body.jobId || jobId).trim();
  const fileName = String(body.fileName || '').trim();
  const fileSize = Number(body.fileSize || 0);
  const mimeType = String(body.mimeType || 'application/pdf').trim();
  const objectPath = String(body.path || '').trim();
  const bucket = String(body.bucket || DEFAULT_BUCKET).trim();

  if (!documentId) {
    return NextResponse.json(
      { error: 'missing_document_id', message: 'Document ID is required.', requestId },
      { status: 400 },
    );
  }

  // Update document status — use correct column names
  const updatePayload: Record<string, any> = {
    status: 'uploaded',
    updated_at: new Date().toISOString(),
  };
  if (fileName) updatePayload.file_name = fileName;
  if (fileSize) updatePayload.file_size_bytes = fileSize; // ← correct column
  if (objectPath) updatePayload.file_path = objectPath;   // ← correct column

  const { error: updateError } = await supabase
    .from('au_documents')
    .update(updatePayload)
    .eq('id', documentId)
    .eq('user_id', userId);

  if (updateError) {
    console.error('[document-upload] Document update error:', {
      message: updateError.message,
      code: updateError.code,
      requestId,
    });
    // Non-fatal: continue to create the worker job
  }

  // Create or update a worker job for RAG processing — use upsert for idempotency
  const { error: jobError } = await supabase.from('au_worker_jobs').upsert({
    id: jobId,
    upload_id: uploadId,
    user_id: userId,
    owner_id: userId,
    document_id: documentId,
    status: 'queued',
    progress: 0,
    file_name: fileName,
    file_size_bytes: fileSize,    // ← correct column (not file_size)
    mime_type: mimeType,
    object_path: objectPath,      // ← correct column (not storage_path)
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
    return NextResponse.json(
      {
        error: 'job_creation_failed',
        message: `Failed to create processing job: ${jobError.message}`,
        requestId,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    jobId,
    documentId,
    requestId,
  });
}
