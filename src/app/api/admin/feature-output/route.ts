import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { clearFeatureOutput, resolveDocumentVersion } from '@/lib/server/ai-governance';

export const runtime = 'nodejs';

const FEATURES = new Set(['knowledge_hub', 'exam_prediction', 'practice_exam_generation', 'chat']);

function normalizeFeature(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return FEATURES.has(normalized) ? normalized : null;
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const body = await req.json().catch(() => ({}));
  const userId = String((body as any)?.userId || adminResult.auth.userId).trim();
  const feature = normalizeFeature((body as any)?.feature);
  const documentId = String((body as any)?.documentId || '').trim();
  let docVersionId = String((body as any)?.docVersionId || '').trim();

  if (!feature && !documentId && !docVersionId) {
    return NextResponse.json(
      { ok: false, code: 'clear_scope_required', message: 'Provide at least one of feature, documentId, or docVersionId.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const correlationId = req.headers.get('x-correlation-id') || requestId;

  try {
    let previousFailureReason = null;
    if (docVersionId && feature) {
      const { data: existing } = await adminResult.supabase
        .from('au_feature_outputs')
        .select('status, output')
        .eq('user_id', userId)
        .eq('doc_version_id', docVersionId)
        .eq('feature', feature)
        .maybeSingle();
      
      if (existing?.status === 'failed') {
        previousFailureReason = (existing.output as any)?.error?.message || 'unknown';
      }
    }

    if (!docVersionId && documentId) {
      docVersionId =
        (
          await resolveDocumentVersion({
            supabase: adminResult.supabase,
            userId,
            documentId,
          })
        ).versionId || '';
    }

    const cleared = await clearFeatureOutput({
      supabase: adminResult.supabase,
      userId,
      docVersionId: docVersionId || null,
      feature,
    });

    // Audit logging for cache-clear action
    if (cleared > 0) {
      await adminResult.supabase.from('au_admin_audit_logs').insert({
        admin_id: adminResult.auth.userId,
        action: 'clear_feature_output_cache',
        target_user_id: userId,
        target_doc_version_id: docVersionId || null,
        metadata: {
          feature,
          document_id: documentId || null,
          cleared_count: cleared,
          previous_failure_reason: previousFailureReason,
          correlation_id: correlationId,
        },
      }).catch(err => console.error('[admin] audit log failed', err));
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        correlationId,
        cleared,
        feature,
        userId,
        doc_version_id: docVersionId || null,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err: any) {
    console.error('[admin] feature output clear failed', err);
    return NextResponse.json(
      { ok: false, code: 'internal_error', message: err.message, requestId, correlationId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const body = await req.json().catch(() => ({}));
  const userId = String((body as any)?.userId || '').trim();
  const feature = normalizeFeature((body as any)?.feature);
  const documentId = String((body as any)?.documentId || '').trim();
  let docVersionId = String((body as any)?.docVersionId || '').trim();

  if (!userId) {
    return NextResponse.json(
      { ok: false, code: 'user_required', message: 'userId is required to clear cached outputs.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!feature && !documentId && !docVersionId) {
    return NextResponse.json(
      { ok: false, code: 'clear_scope_required', message: 'Provide at least one of feature, documentId, or docVersionId.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const correlationId = req.headers.get('x-correlation-id') || requestId;

  try {
    if (!docVersionId && documentId) {
      docVersionId =
        (
          await resolveDocumentVersion({
            supabase: adminResult.supabase,
            userId,
            documentId,
          })
        ).versionId || '';
    }

    const cleared = await clearFeatureOutput({
      supabase: adminResult.supabase,
      userId,
      docVersionId: docVersionId || null,
      feature,
    });

    return NextResponse.json(
      {
        ok: true,
        requestId,
        correlationId,
        cleared,
        feature,
        userId,
        doc_version_id: docVersionId || null,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err: any) {
    console.error('[admin] feature output clear failed (POST)', err);
    return NextResponse.json(
      { ok: false, code: 'internal_error', message: err.message, requestId, correlationId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
