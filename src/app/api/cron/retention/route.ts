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
    const dryRunParam = String(req.nextUrl.searchParams.get('dryRun') || req.nextUrl.searchParams.get('dry_run') || '').trim().toLowerCase();
    const dryRun = dryRunParam === '1' || dryRunParam === 'true' || dryRunParam === 'yes' || dryRunParam === 'preview';
    const result = await runRetentionCleanup({
      dryRun,
      triggerSource: 'cron',
      previewLimit: Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit') || 50))),
    });

    return NextResponse.json(
      {
        ok: true,
        dryRun,
        locked: result.locked,
        runId: result.runId,
        execution: result.execution,
        summary: {
          documentsQueuedForDeletion: result.summary.documentsQueuedForDeletion,
          failedActions: result.summary.failedActions,
          activeUsers: result.summary.activeUsers,
          scheduledFileDeletionUsers: result.summary.scheduledFileDeletionUsers,
          filesDeletedUsers: result.summary.filesDeletedUsers,
        },
        generatedAt: result.generatedAt,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
        error: 'retention_cleanup_failed',
        message: 'Retention cleanup failed.',
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
