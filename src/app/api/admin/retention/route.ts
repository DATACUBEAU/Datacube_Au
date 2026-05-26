import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRetentionOverview, runRetentionCleanup } from '@/lib/server/retention';
import {
  AccessControlError,
  requireAdmin,
} from '@/lib/server/authorization';

export const runtime = 'nodejs';

class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function requireConexAdmin(req: NextRequest) {
  const { auth } = await requireAdmin(req);
  return {
    userId: auth.userId,
  };
}

function jsonError(error: unknown) {
  if (error instanceof AccessControlError) {
    return NextResponse.json(
      { error: error.decision.code || 'forbidden', details: error.decision.reason },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, details: error.details ?? null },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'invalid_request', details: error.flatten() },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: 'internal_server_error', details: String((error as any)?.message || error || '') },
    { status: 500 },
  );
}

const postSchema = z.object({
  action: z.enum(['preview', 'run']),
  previewLimit: z.coerce.number().int().min(1).max(200).optional().default(50),
  force: z.boolean().optional().default(false),
});

export async function GET(req: NextRequest) {
  try {
    await requireConexAdmin(req);
    const previewLimit = Math.max(
      1,
      Math.min(200, Number(req.nextUrl.searchParams.get('limit') || 50)),
    );
    const overview = await getRetentionOverview(previewLimit);
    return NextResponse.json({ ok: true, overview });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireConexAdmin(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError(400, 'invalid_body', 'Expected JSON body.');
    }

    const payload = postSchema.parse(body);
    const result = await runRetentionCleanup({
      dryRun: payload.action === 'preview',
      triggerSource: payload.action === 'preview' ? 'admin_preview' : 'admin_run',
      initiatedBy: actor.userId,
      previewLimit: payload.previewLimit,
      force: payload.force,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return jsonError(error);
  }
}
