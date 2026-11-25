import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { listAdminFeedback, FEEDBACK_TABLES } from '@/lib/server/admin-feedback';

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
          sourceTables: FEEDBACK_TABLES,
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

// Only explicit, bounded selections from the two feedback tables may be removed.
export async function DELETE(req: NextRequest) {
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;
  const body = await req.json().catch(() => null);
  const ids = body?.records;
  if (body?.confirm !== true || !Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
      ids.some(row => !row || !FEEDBACK_TABLES.includes(row.source_table) ||
        typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id))) {
    return NextResponse.json({error:'invalid_selection'}, {status:400, headers:{'Cache-Control':'no-store'}});
  }
  let deleted = 0;
  for (const table of FEEDBACK_TABLES) {
    const selected = [...new Set<string>(ids.filter(row => row.source_table === table).map(row => row.id))];
    if (!selected.length) continue;
    const {error,count} = await adminResult.supabase.from(table).delete({count:'exact'}).in('id',selected);
    if (error) return NextResponse.json({ok:false,error:'feedback_delete_failed',deleted}, {status:500,headers:{'Cache-Control':'no-store'}});
    deleted += count ?? 0;
  }
  return NextResponse.json({ok:true,deleted}, {headers:{'Cache-Control':'no-store'}});
}
