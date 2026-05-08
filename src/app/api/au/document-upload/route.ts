import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { resolveCanonicalEffectiveLimits } from '@/lib/server/au-limits';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const DEFAULT_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';

/**
 * Local document upload handler — replaces the deleted /api/proxy/document-upload
 * which proxied to a Supabase Edge Function.
 *
 * Handles two actions:
 *   - initiate: validates limits, creates signed upload URL, registers document row
 *   - complete: marks upload as complete, creates a worker job for RAG processing
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
    console.error(`[document-upload] error:`, error?.message || error);
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
  const metadata = body.metadata || null;

  if (!fileName) {
    return NextResponse.json(
      { error: 'missing_filename', message: 'File name is required.', requestId },
      { status: 400 },
    );
  }

  // Check limits
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

  // Determine storage path and bucket
  const bucket = DEFAULT_BUCKET;
  const ext = fileName.includes('.') ? fileName.split('.').pop() : 'pdf';
  const storagePath = `uploads/${userId}/${documentId}.${ext}`;

  // Create a signed upload URL
  const { data: signedData, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);

  if (signedError) {
    console.error('[document-upload] signed URL error:', signedError);
    return NextResponse.json(
      { error: 'signed_url_failed', message: 'Failed to create upload URL.', requestId },
      { status: 500 },
    );
  }

  // Insert the document row — only columns that exist in the schema
  const { error: insertError } = await supabase.from('au_documents').insert({
    id: documentId,
    user_id: userId,
    file_name: fileName,
    file_size: fileSize,
    document_type: documentType,
    storage_path: storagePath,
    bucket,
    status: 'uploading',
    parent_id: parentId,
    parent_document_id: parentDocumentId,
    metadata: metadata ? JSON.stringify(metadata) : null,
    correlation_id: correlationId,
    created_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error('[document-upload] insert error:', insertError);
    return NextResponse.json(
      { error: 'insert_failed', message: String(insertError.message || 'Failed to register document.'), requestId },
      { status: 500 },
    );
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
  const fileName = String(body.fileName || '').trim();
  const fileSize = Number(body.fileSize || 0);
  const mimeType = String(body.mimeType || 'application/pdf').trim();
  const path = String(body.path || '').trim();
  const bucket = String(body.bucket || DEFAULT_BUCKET).trim();

  if (!documentId) {
    return NextResponse.json(
      { error: 'missing_document_id', message: 'Document ID is required.', requestId },
      { status: 400 },
    );
  }

  // Update document status
  const { error: updateError } = await supabase
    .from('au_documents')
    .update({
      status: 'uploaded',
      file_name: fileName || undefined,
      file_size: fileSize || undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('user_id', userId);

  if (updateError) {
    console.error('[document-upload] update error:', updateError);
  }

  // Create a worker job for RAG processing
  const { error: jobError } = await supabase.from('au_worker_jobs').insert({
    id: jobId,
    user_id: userId,
    document_id: documentId,
    job_type: 'ingest',
    status: 'pending',
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType,
    storage_path: path,
    bucket,
    correlation_id: correlationId,
    created_at: new Date().toISOString(),
  });

  if (jobError) {
    console.error('[document-upload] job insert error:', jobError);
    return NextResponse.json(
      { error: 'job_creation_failed', message: String(jobError.message || 'Failed to create processing job.'), requestId },
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
