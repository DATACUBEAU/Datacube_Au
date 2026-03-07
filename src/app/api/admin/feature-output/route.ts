import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { clearFeatureOutput, resolveDocumentVersion } from '@/lib/server/ai-governance';

export const runtime = 'nodejs';

const FEATURES = new Set(['knowledge_hub', 'exam_prediction', 'practice_exam_generation']);

function normalizeFeature(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return FEATURES.has(normalized) ? normalized : null;
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
        cleared,
        feature,
        userId,
        doc_version_id: docVersionId || null,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, code: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
