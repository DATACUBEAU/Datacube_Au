import { NextRequest, NextResponse } from 'next/server';
import { readFeatureOutput, resolveDocumentVersion } from '@/lib/server/ai-governance';
import { featureFromFeatureOutput } from '@/lib/authz/access-control';
import {
  accessControlResponse,
  isAccessControlError,
  requireEntitlement,
} from '@/lib/server/authorization';

export const runtime = 'nodejs';

const FEATURES = new Set(['knowledge_hub', 'exam_prediction', 'practice_exam_generation']);
const SUCCESS_CACHE_CONTROL = 'no-store, private';

function normalizeFeature(value: string | null): 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (FEATURES.has(normalized)) {
    return normalized as 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation';
  }
  return null;
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
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
    const featureKey = featureFromFeatureOutput(feature);
    if (!featureKey) {
      return NextResponse.json(
        { ok: false, code: 'invalid_feature', message: 'Unsupported feature.', requestId },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const authorization = await requireEntitlement(req, featureKey);
    const { auth, supabase } = authorization;
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
          message: 'No saved output was found for this document yet.',
        },
        { status: 200, headers: { 'Cache-Control': SUCCESS_CACHE_CONTROL } },
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
          message: 'No saved output was found for this document yet.',
        },
        { status: 200, headers: { 'Cache-Control': SUCCESS_CACHE_CONTROL } },
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
        message:
          record.status === 'running'
            ? 'This generation is still in progress.'
            : record.status === 'failed'
              ? 'The last saved generation failed. Clear the cached output or upload a new version before retrying.'
              : undefined,
      },
      { status: 200, headers: { 'Cache-Control': SUCCESS_CACHE_CONTROL } },
    );
  } catch (error: any) {
    if (isAccessControlError(error)) {
      return accessControlResponse(error, requestId);
    }
    return NextResponse.json(
      { ok: false, code: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
