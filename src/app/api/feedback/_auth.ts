import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function requireConexAdmin(req: NextRequest) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'unauthorized', message: 'Sign in required.', details: { reason: auth.reason } },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }

  const supabase = createSupabaseAdminClient();
  const { data: profile, error } = await supabase
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (error) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'forbidden', message: 'Conex admin access required.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }

  const allowed = hasConexAccess({
    userId: auth.userId,
    email: auth.email,
    tier: (profile as any)?.tier ?? null,
  });
  if (!allowed) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'forbidden', message: 'Conex admin access required.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }

  return { ok: true as const, auth, supabase };
}

