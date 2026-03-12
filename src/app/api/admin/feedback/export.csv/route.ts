import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { listAdminFeedback } from '@/lib/server/admin-feedback';

export const runtime = 'nodejs';

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (!text.includes('"') && !text.includes(',') && !text.includes('\n')) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  try {
    const { rows } = await listAdminFeedback(adminResult.supabase, {
      limit: 10000,
      from,
      to,
    });

    const header = ['Date', 'Section', 'Rating', 'Comment', 'User'];
    const dataRows = rows.map((row) => [
      row.created_at || '',
      row.section || '',
      row.rating_label || '',
      row.comment || '',
      row.user_label || '',
    ]);

    const csv = [header, ...dataRows]
      .map((parts) => parts.map((value) => csvEscape(value)).join(','))
      .join('\n');

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="au_feedback_${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: 'feedback_export_failed',
        message: String(error?.message || 'Failed to export feedback.'),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
