import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireConexAdmin } from './_auth';

export const runtime = 'nodejs';

const FeedbackInsertSchema = z.object({
  section: z.string().min(1).max(120),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  comment: z.string().max(4000).optional().nullable(),
  metadata: z.record(z.any()).optional(),
});

function toIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'payload',
    message: issue.message,
    code: issue.code,
  }));
}

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
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in required.', requestId, details: { reason: auth.reason } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = FeedbackInsertSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', message: 'Invalid feedback payload.', requestId, details: { issues: toIssues(parsed.error) } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // ---------------------------------------------------------------------------
  // Idempotency: extract key from header or body. Generate one if not provided
  // so that every write is always protected by a UNIQUE constraint.
  // ---------------------------------------------------------------------------
  const idempotencyKey = extractIdempotencyKey(req, body) || crypto.randomUUID();

  try {
    const supabase = createSupabaseAdminClient();
    const payload = {
      user_id: auth.userId,
      section: parsed.data.section.trim(),
      rating: parsed.data.rating ?? null,
      comment:
        typeof parsed.data.comment === 'string'
          ? parsed.data.comment.trim() || null
          : null,
      metadata:
        parsed.data.metadata && typeof parsed.data.metadata === 'object'
          ? parsed.data.metadata
          : {},
      idempotency_key: idempotencyKey,
    };

    // Upsert on idempotency_key — duplicate retries produce the same row.
    const { data, error } = await supabase
      .from('au_user_feedback')
      .upsert(payload, { onConflict: 'idempotency_key' })
      .select('id,created_at,user_id,section,rating,comment,metadata')
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: 'feedback_insert_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, requestId, feedback: data },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 50;
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  try {
    let query = adminResult.supabase
      .from('au_user_feedback')
      .select('id,created_at,user_id,section,rating,comment,metadata')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: 'feedback_fetch_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, requestId, feedback: data || [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const body = await req.json().catch(() => ({}));
  const from = typeof body?.from === 'string' ? body.from : null;
  const to = typeof body?.to === 'string' ? body.to : null;

  try {
    let query = adminResult.supabase.from('au_user_feedback').delete();
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    const { error } = await query;
    if (error) {
      return NextResponse.json(
        { error: 'feedback_delete_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, requestId, cleared: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
