import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  accessControlResponse,
  isAccessControlError,
  requireAdmin,
} from '@/lib/server/authorization';
import {
  ConexAccessError,
  buildConexDashboardUsers,
  listConexDashboardUsers,
  setConexTierForUser,
  type ConexProfileRow,
  type ConexUsersRepository,
} from '@/lib/server/conex-users-service';

export const runtime = 'nodejs';

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

function createSupabaseServerClient(accessToken?: string) {
  const url = firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const serviceRoleKey = firstEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
  const anonKey = firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
  const key = serviceRoleKey ?? anonKey;

  if (!url || !key) {
    throw new ConexAccessError(
      503,
      'server_misconfigured',
      'Missing Supabase environment variables. Configure SUPABASE URL and key in Vercel.'
    );
  }

  const headers: Record<string, string> = {};
  if (!serviceRoleKey && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return createClient(url, key, {
    global: Object.keys(headers).length > 0 ? { headers } : undefined,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createConexUsersRepo(accessToken?: string): ConexUsersRepository {
  const supabase = createSupabaseServerClient(accessToken);
  const selectColumns = 'user_id,tier,full_name,avatar_url';

  return {
    async getProfileByUserId(userId: string) {
      const { data, error } = await supabase
        .from('au_user_profiles')
        .select(selectColumns)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as ConexProfileRow | null) ?? null;
    },
    async listProfiles() {
      const { data, error } = await supabase
        .from('au_user_profiles')
        .select(selectColumns)
        .limit(1000);
      if (error) throw error;
      return (data as ConexProfileRow[] | null) ?? [];
    },
    async upsertTier(userId: string, tier: 'admin' | 'free') {
      const { error } = await supabase
        .from('au_user_profiles')
        .upsert({ user_id: userId, tier }, { onConflict: 'user_id' });
      if (error) throw error;

      const { data, error: readError } = await supabase
        .from('au_user_profiles')
        .select(selectColumns)
        .eq('user_id', userId)
        .maybeSingle();
      if (readError) throw readError;
      return (data as ConexProfileRow | null) ?? null;
    },
  };
}

function toErrorResponse(error: unknown): NextResponse {
  if (isAccessControlError(error)) {
    return accessControlResponse(error);
  }
  if (error instanceof ConexAccessError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'internal_server_error';
  return NextResponse.json({ error: 'internal_server_error', message }, { status: 500 });
}

async function requireActor(req: NextRequest): Promise<
  { ok: true; actor: { userId: string; email: string | null; accessToken: string } } | { ok: false; response: NextResponse }
> {
  try {
    const { auth } = await requireAdmin(req);
    return {
      ok: true,
      actor: {
        userId: auth.userId,
        email: auth.email ?? null,
        accessToken: auth.accessToken,
      },
    };
  } catch (error) {
    if (isAccessControlError(error)) {
      return {
        ok: false,
        response: accessControlResponse(error),
      };
    }
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const actorResult = await requireActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const mode = req.nextUrl.searchParams.get('mode');
    if (mode === 'access') {
      return NextResponse.json({ ok: true, access: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const repo = createConexUsersRepo(actorResult.actor.accessToken);
    const data = await listConexDashboardUsers(repo, actorResult.actor);
    return NextResponse.json(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const actorResult = await requireActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid_body', message: 'Expected JSON body.' }, { status: 400 });
    }

    const targetUserId = String((body as any).userId || '').trim();
    const tier = (body as any).tier;

    const repo = createConexUsersRepo(actorResult.actor.accessToken);
    const updated = await setConexTierForUser(repo, actorResult.actor, targetUserId, tier);

    // Return the refreshed dashboard payload so UI state stays consistent after toggles.
    const allRows = await repo.listProfiles();
    const dashboard = buildConexDashboardUsers(allRows);

    return NextResponse.json({
      ok: true,
      updated,
      ...dashboard,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
