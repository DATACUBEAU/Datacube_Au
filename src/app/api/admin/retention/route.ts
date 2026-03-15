import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import { getRetentionOverview, runRetentionCleanup } from '@/lib/server/retention';

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

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

function createServiceRoleClient() {
  const supabaseUrl = firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const serviceRoleKey = firstEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(503, 'server_misconfigured', 'Missing Supabase service role configuration.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function requireConexAdmin(req: NextRequest) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    throw new ApiError(401, 'unauthorized');
  }

  const supabase = createServiceRoleClient();
  const { data: profile, error } = await supabase
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, 'profile_lookup_failed', error.message);
  }

  const allowed = hasConexAccess({
    userId: auth.userId,
    email: auth.email ?? null,
    tier: profile?.tier ?? null,
  });

  if (!allowed) {
    throw new ApiError(403, 'forbidden');
  }

  return {
    userId: auth.userId,
  };
}

function jsonError(error: unknown) {
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
