import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';

const CONEX_USERS_PATH_PREFIX = '/conex/users';
const CONEX_PATH_PREFIX = '/conex';
const DASHBOARD_PATH_PREFIX = '/dashboard';
const FRAME_ANCESTORS_POLICY = "frame-ancestors 'none'";

function isConexUsersApi(pathname: string): boolean {
  return pathname === CONEX_USERS_PATH_PREFIX || pathname.startsWith(`${CONEX_USERS_PATH_PREFIX}/`);
}

function isDashboardRoute(pathname: string): boolean {
  return pathname === DASHBOARD_PATH_PREFIX || pathname.startsWith(`${DASHBOARD_PATH_PREFIX}/`);
}

function isConexRoute(pathname: string): boolean {
  return pathname === CONEX_PATH_PREFIX || pathname.startsWith(`${CONEX_PATH_PREFIX}/`);
}

function mergeFrameAncestorsDirective(cspHeader: string | null): string {
  if (!cspHeader) return FRAME_ANCESTORS_POLICY;

  const directives = cspHeader
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean);

  let replaced = false;
  const mergedDirectives = directives.map((directive) => {
    if (!directive.toLowerCase().startsWith('frame-ancestors')) return directive;
    replaced = true;
    return FRAME_ANCESTORS_POLICY;
  });

  if (!replaced) mergedDirectives.push(FRAME_ANCESTORS_POLICY);
  return mergedDirectives.join('; ');
}

function applyClickjackingHeaders(response: NextResponse): NextResponse {
  const mergedCsp = mergeFrameAncestorsDirective(response.headers.get('Content-Security-Policy'));
  response.headers.set('Content-Security-Policy', mergedCsp);
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

function loginRedirect(req: NextRequest): NextResponse {
  const loginUrl = new URL('/login', req.url);
  const redirectTarget = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  loginUrl.searchParams.set('redirectTo', redirectTarget);
  return applyClickjackingHeaders(NextResponse.redirect(loginUrl));
}

function forbiddenRedirect(req: NextRequest): NextResponse {
  return applyClickjackingHeaders(NextResponse.redirect(new URL('/403', req.url)));
}

function unauthorizedResponse(req: NextRequest): NextResponse {
  if (isConexUsersApi(req.nextUrl.pathname)) {
    return applyClickjackingHeaders(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
  }
  return loginRedirect(req);
}

function forbiddenResponse(req: NextRequest): NextResponse {
  if (isConexUsersApi(req.nextUrl.pathname)) {
    return applyClickjackingHeaders(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
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
  const pathname = req.nextUrl.pathname;

  if (isDashboardRoute(pathname)) {
    return applyClickjackingHeaders(NextResponse.next());
  }

  if (!isConexRoute(pathname)) {
    return applyClickjackingHeaders(NextResponse.next());
  }

  const auth = await requireUserFromRequest(req);
  if (!auth.ok) return unauthorizedResponse(req);

  // Fast-path: known root admin identity can pass without DB lookup.
  if (hasConexAccess({ userId: auth.userId, email: auth.email, tier: null })) {
    return applyClickjackingHeaders(NextResponse.next());
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
  return applyClickjackingHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
