import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { resolveDocumentVersion } from '@/lib/server/ai-governance';

export const runtime = 'nodejs';

const AttemptSchema = z.object({
  documentId: z.string().uuid(),
  answers: z.any(),
  score: z.number().int().min(0).optional().nullable(),
  metadata: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: 'unauthorized', message: 'Sign in required.', requestId },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

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

  try {
    const supabase = createSupabaseAdminClient();
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

    const { error } = await supabase.from('au_practice_attempts').insert({
      user_id: auth.userId,
      doc_version_id: version.versionId,
      answers: parsed.data.answers,
      score: parsed.data.score ?? null,
      metadata: parsed.data.metadata || {},
    });

    if (error) {
      return NextResponse.json(
        { ok: false, code: 'practice_attempt_save_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, requestId, docVersionId: version.versionId },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, code: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
