import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';

function isConexUsersApi(pathname: string): boolean {
  return pathname === '/conex/users';
}

function loginRedirect(req: NextRequest): NextResponse {
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('redirectTo', req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

function forbiddenRedirect(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL('/403', req.url));
}

function unauthorizedResponse(req: NextRequest): NextResponse {
  if (isConexUsersApi(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return loginRedirect(req);
}

function forbiddenResponse(req: NextRequest): NextResponse {
  if (isConexUsersApi(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return forbiddenRedirect(req);
}

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/conex')) return NextResponse.next();

  const auth = await requireUserFromRequest(req);
  if (!auth.ok) return unauthorizedResponse(req);

  // Fast-path: known root admin identity can pass without DB lookup.
  if (hasConexAccess({ userId: auth.userId, email: auth.email, tier: null })) {
    return NextResponse.next();
  }

  const supabase = getServiceClient();
  if (!supabase) return forbiddenResponse(req);

  const { data: profile, error } = await supabase
    .from('au_user_profiles')
    .select('user_id,tier')
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (error) {
    console.error('[middleware:/conex] Failed to read au_user_profiles:', error.message);
    return forbiddenResponse(req);
  }

  const allowed = hasConexAccess({
    userId: auth.userId,
    email: auth.email,
    tier: profile?.tier ?? null,
  });

  if (!allowed) return forbiddenResponse(req);
  return NextResponse.next();
}

export const config = {
  matcher: ['/conex/users', '/conex/users/:path*'],
};
