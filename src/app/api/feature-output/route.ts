import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readFeatureOutput, resolveDocumentVersion } from '@/lib/server/ai-governance';

export const runtime = 'nodejs';

const FEATURES = new Set(['knowledge_hub', 'exam_prediction', 'practice_exam_generation']);

function normalizeFeature(value: string | null): 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (FEATURES.has(normalized)) {
    return normalized as 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation';
  }
  return null;
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: 'unauthorized', message: 'Sign in required.', requestId },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const feature = normalizeFeature(req.nextUrl.searchParams.get('feature'));
  const documentId = String(req.nextUrl.searchParams.get('documentId') || '').trim();
  const docVersionId = String(req.nextUrl.searchParams.get('docVersionId') || '').trim();

  if (!feature) {
    return NextResponse.json(
      { ok: false, code: 'invalid_feature', message: 'Feature must be knowledge_hub, exam_prediction, or practice_exam_generation.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!documentId && !docVersionId) {
    return NextResponse.json(
      { ok: false, code: 'document_required', message: 'Provide documentId or docVersionId.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const resolvedVersionId =
      docVersionId ||
      (
        await resolveDocumentVersion({
          supabase,
          userId: auth.userId,
          documentId,
        })
      ).versionId ||
      null;

    if (!resolvedVersionId) {
      return NextResponse.json(
        {
          ok: true,
          status: 'missing',
          feature,
          requestId,
          doc_version_id: null,
          output: null,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const record = await readFeatureOutput({
      supabase,
      userId: auth.userId,
      docVersionId: resolvedVersionId,
      feature,
    });

    if (!record) {
      return NextResponse.json(
        {
          ok: true,
          status: 'missing',
          feature,
          requestId,
          doc_version_id: resolvedVersionId,
          output: null,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        status: record.status,
        feature,
        requestId,
        doc_version_id: resolvedVersionId,
        output: record.output ?? null,
        generatedAt: record.updatedAt || record.createdAt,
        model: record.model,
        tokens: record.tokens,
        cost_usd: record.costUsd,
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
