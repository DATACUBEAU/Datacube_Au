import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import {
  ConexAccessError,
  buildConexDashboardUsers,
  listConexDashboardUsers,
  setConexTierForUser,
  type ConexProfileRow,
  type ConexUsersRepository,
} from '@/lib/server/conex-users-service';

export const runtime = 'nodejs';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function createServiceRoleClient() {
  return createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createConexUsersRepo(): ConexUsersRepository {
  const supabase = createServiceRoleClient();
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
  if (error instanceof ConexAccessError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'internal_server_error';
  return NextResponse.json({ error: 'internal_server_error', message }, { status: 500 });
}

async function requireActor(req: NextRequest): Promise<
  { ok: true; actor: { userId: string; email: string | null } } | { ok: false; response: NextResponse }
> {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }

  return {
    ok: true,
    actor: {
      userId: auth.userId,
      email: auth.email ?? null,
    },
  };
}

export async function GET(req: NextRequest) {
  const actorResult = await requireActor(req);
  if (!actorResult.ok) return actorResult.response;

  try {
    const mode = req.nextUrl.searchParams.get('mode');
    if (mode === 'access') {
      // Fast-path: root admin by known identity.
      if (hasConexAccess({ userId: actorResult.actor.userId, email: actorResult.actor.email, tier: null })) {
        return NextResponse.json({ ok: true, access: true });
      }

      // Fallback: check tier from profile when service role is available.
      try {
        const repo = createConexUsersRepo();
        const profile = await repo.getProfileByUserId(actorResult.actor.userId);
        const allowed = hasConexAccess({
          userId: actorResult.actor.userId,
          email: actorResult.actor.email,
          tier: profile?.tier ?? null,
        });
        if (allowed) return NextResponse.json({ ok: true, access: true });
      } catch {
      }

      return NextResponse.json({ error: 'forbidden', access: false }, { status: 403 });
    }

    const repo = createConexUsersRepo();
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

    const repo = createConexUsersRepo();
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
