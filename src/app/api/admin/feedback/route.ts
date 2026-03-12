import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { listAdminFeedback } from '@/lib/server/admin-feedback';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 200;
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  try {
    const { rows, count } = await listAdminFeedback(adminResult.supabase, {
      limit,
      from,
      to,
    });

    return NextResponse.json(
      {
        ok: true,
        requestId,
        feedback: rows,
        meta: {
          count,
          sourceTable: 'au_feedback',
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: 'feedback_fetch_failed',
        message: String(error?.message || 'Failed to load feedback.'),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
