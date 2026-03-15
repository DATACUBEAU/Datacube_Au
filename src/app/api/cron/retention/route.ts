import { NextRequest, NextResponse } from 'next/server';
import { runRetentionCleanup } from '@/lib/server/retention';
import { firstEnv } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const expected = firstEnv('RETENTION_CRON_SECRET', 'CRON_SECRET');
  if (!expected) {
    return false;
  }

  const headerToken =
    req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  return Boolean(headerToken && headerToken === expected);
}

async function handleRun(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await runRetentionCleanup({
      dryRun: false,
      triggerSource: 'cron',
      previewLimit: Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit') || 50))),
    });

    return NextResponse.json(
      {
        ok: true,
        locked: result.locked,
        runId: result.runId,
        execution: result.execution,
        summary: result.summary,
        generatedAt: result.generatedAt,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'retention_cleanup_failed',
        message: String(error?.message || 'Retention cleanup failed.'),
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handleRun(req);
}

export async function POST(req: NextRequest) {
  return handleRun(req);
}
