import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveDocumentVersion } from '@/lib/server/ai-governance';
import {
  accessControlResponse,
  isAccessControlError,
  requireEntitlement,
} from '@/lib/server/authorization';

export const runtime = 'nodejs';

const AttemptSchema = z.object({
  documentId: z.string().uuid(),
  answers: z.any(),
  score: z.number().int().min(0).optional().nullable(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Extract and validate idempotency key from request.
 * Sources (in priority order): x-idempotency-key header, body.idempotencyKey.
 * Returns null only if neither source provides a key.
 */
function extractIdempotencyKey(req: NextRequest, body: any): string | null {
  const fromHeader = req.headers.get('x-idempotency-key')?.trim();
  if (fromHeader) return fromHeader;
  const fromBody = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  return fromBody || null;
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  let authorization: Awaited<ReturnType<typeof requireEntitlement>>;
  try {
    authorization = await requireEntitlement(req, 'practice_exam_generation');
  } catch (error) {
    if (isAccessControlError(error)) return accessControlResponse(error, requestId);
    throw error;
  }
  const auth = authorization.auth;

  const body = await req.json().catch(() => null);
  const parsed = AttemptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_payload',
        message: 'Invalid practice attempt payload.',
        requestId,
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'payload',
          code: issue.code,
          message: issue.message,
        })),
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // ---------------------------------------------------------------------------
  // Idempotency: extract key from header or body. Generate one if not provided
  // so that every write is always protected by a UNIQUE constraint.
  // ---------------------------------------------------------------------------
  const idempotencyKey = extractIdempotencyKey(req, body) || crypto.randomUUID();

  try {
    const supabase = authorization.supabase;
    const version = await resolveDocumentVersion({
      supabase,
      userId: auth.userId,
      documentId: parsed.data.documentId,
    });

    if (!version.versionId) {
      return NextResponse.json(
        {
          ok: false,
          code: 'document_version_not_found',
          message: 'Document version could not be resolved for this practice attempt.',
          requestId,
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Upsert on idempotency_key — duplicate retries produce the same row.
    const { data, error } = await supabase
      .from('au_practice_attempts')
      .upsert(
        {
          user_id: auth.userId,
          doc_version_id: version.versionId,
          answers: parsed.data.answers,
          score: parsed.data.score ?? null,
          metadata: parsed.data.metadata || {},
          idempotency_key: idempotencyKey,
        },
        { onConflict: 'idempotency_key' },
      )
      .select('id')
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, code: 'practice_attempt_save_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, requestId, docVersionId: version.versionId, attemptId: data?.id ?? null },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, code: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
