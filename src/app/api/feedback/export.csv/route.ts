import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';

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
    let query = adminResult.supabase
      .from('au_user_feedback')
      .select('created_at,user_id,section,rating,comment')
      .order('created_at', { ascending: false })
      .limit(10000);

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: 'feedback_export_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const header = ['Date', 'User', 'Section', 'Rating', 'Comment'];
    const rows = (data || []).map((row: any) => ([
      row?.created_at || '',
      row?.user_id || '',
      row?.section || '',
      row?.rating == null ? '' : String(row.rating),
      row?.comment || '',
    ]));

    const csv = [header, ...rows]
      .map((parts) => parts.map((value) => csvEscape(value)).join(','))
      .join('\n');

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="au_feedback_${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

