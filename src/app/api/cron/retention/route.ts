import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runRetentionCleanup } from '@/lib/server/retention';

export const runtime = 'nodejs';

function jsonNoStore(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private');
  return NextResponse.json(body, { ...init, headers });
}

function configuredCronSecrets(): string[] {
  return ['RETENTION_CRON_SECRET', 'CRON_SECRET']
    .map((key) => String(process.env[key] || '').trim())
    .filter(Boolean);
}

function safeSecretEquals(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function authorized(req: NextRequest): boolean {
  const expectedSecrets = configuredCronSecrets();
  if (expectedSecrets.length === 0) {
    return false;
  }

  const headerToken =
    req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  return Boolean(headerToken && expectedSecrets.some((expected) => safeSecretEquals(headerToken, expected)));
}

async function handleRun(req: NextRequest) {
  if (!authorized(req)) {
    return jsonNoStore({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const dryRunParam = String(req.nextUrl.searchParams.get('dryRun') || req.nextUrl.searchParams.get('dry_run') || '').trim().toLowerCase();
    const dryRun = dryRunParam === '1' || dryRunParam === 'true' || dryRunParam === 'yes' || dryRunParam === 'preview';
    const result = await runRetentionCleanup({
      dryRun,
      triggerSource: 'cron',
      previewLimit: Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit') || 50))),
    });

    return jsonNoStore(
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
    return jsonNoStore(
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
