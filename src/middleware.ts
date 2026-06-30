import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { normalizeAdminOverridePlan } from '@/lib/admin/protected-owner';
import { hasConexAccess } from '@/lib/conex-rbac';
import {
  ACCESS_NO_STORE_HEADERS,
  evaluateAccess,
  findApiAccessRule,
  findPageAccessRule,
  type AccessDecision,
  type AccessRule,
  type EntitlementSubject,
} from '@/lib/authz/access-control';

const FRAME_ANCESTORS_POLICY = "frame-ancestors 'none'";

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

function applyProtectedHeaders(response: NextResponse): NextResponse {
  applyClickjackingHeaders(response);
  for (const [key, value] of Object.entries(ACCESS_NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}

function isApiLikeRoute(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/conex/users' || pathname.startsWith('/conex/users/');
}

function loginRedirect(req: NextRequest): NextResponse {
  const loginUrl = new URL('/login', req.url);
  const redirectTarget = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  loginUrl.searchParams.set('redirectTo', redirectTarget);
  return applyProtectedHeaders(NextResponse.redirect(loginUrl));
}

function forbiddenRedirect(req: NextRequest): NextResponse {
  return applyProtectedHeaders(NextResponse.redirect(new URL('/403', req.url)));
}

function unauthorizedResponse(req: NextRequest, rule: AccessRule): NextResponse {
  if (isApiLikeRoute(req.nextUrl.pathname)) {
    return applyProtectedHeaders(
      NextResponse.json(
        {
          ok: false,
          code: 'UNAUTHORIZED',
          error: 'unauthorized',
          message: 'Authentication required.',
          routeId: rule.id,
        },
        { status: 401 },
      ),
    );
  }
  return loginRedirect(req);
}

function forbiddenResponse(req: NextRequest, decision: AccessDecision): NextResponse {
  if (isApiLikeRoute(req.nextUrl.pathname)) {
    return applyProtectedHeaders(
      NextResponse.json(
        {
          ok: false,
          code: decision.code || 'FORBIDDEN',
          error: 'forbidden',
          message: decision.reason || 'Access denied.',
          feature: decision.feature || null,
          routeId: decision.routeId || null,
          upgradeUrl: decision.upgradeUrl || null,
        },
        { status: decision.status === 401 ? 401 : 403 },
      ),
    );
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

async function maybeSingle<T>(promise: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> {
  const result = await promise;
  if (result.error) {
    const code = String(result.error?.code || '');
    const message = String(result.error?.message || '').toLowerCase();
    if (code === '42P01' || code === '42703' || message.includes('does not exist') || message.includes('schema cache')) {
      return null;
    }
    throw result.error;
  }
  return result.data || null;
}

async function loadMiddlewareSubject(
  supabase: ReturnType<typeof getServiceClient>,
  auth: Extract<Awaited<ReturnType<typeof requireUserFromRequest>>, { ok: true }>,
): Promise<EntitlementSubject> {
  if (!supabase) {
    return {
      userId: auth.userId,
      email: auth.email,
      plan: 'free',
      profileTier: null,
      hasPro: false,
      entitlementSource: 'none',
      entitlementEndsAt: null,
      adminOverride: hasConexAccess({ userId: auth.userId, email: auth.email, tier: null }),
    };
  }

  const nowIso = new Date().toISOString();
  const [profile, entitlement, grant] = await Promise.all([
    maybeSingle(
      supabase
        .from('au_user_profiles')
        .select('tier')
        .eq('user_id', auth.userId)
        .maybeSingle(),
    ),
    maybeSingle(
      supabase
        .from('au_user_entitlements')
        .select('plan,source,expires_at,admin_override_plan')
        .eq('user_id', auth.userId)
        .maybeSingle(),
    ),
    maybeSingle(
      supabase
        .from('entitlement_grants')
        .select('ends_at')
        .eq('user_id', auth.userId)
        .eq('entitlement', 'pro')
        .eq('status', 'active')
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso)
        .order('ends_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);

  const profileTier = typeof (profile as any)?.tier === 'string' ? String((profile as any).tier) : null;
  const entitlementPlan = typeof (entitlement as any)?.plan === 'string' ? String((entitlement as any).plan) : null;
  const entitlementSource = typeof (entitlement as any)?.source === 'string' ? String((entitlement as any).source) : null;
  const adminOverridePlan = typeof (entitlement as any)?.admin_override_plan === 'string'
    ? String((entitlement as any).admin_override_plan)
    : null;
  const normalizedAdminOverridePlan = normalizeAdminOverridePlan(adminOverridePlan);
  const overrideEffectivePlan = normalizedAdminOverridePlan
    ? normalizedAdminOverridePlan === 'free'
      ? 'free'
      : normalizedAdminOverridePlan === 'premium'
        ? 'premium'
        : 'pro'
    : null;
  const entitlementEndsAt = typeof (entitlement as any)?.expires_at === 'string'
    ? String((entitlement as any).expires_at)
    : typeof (grant as any)?.ends_at === 'string'
      ? String((grant as any).ends_at)
      : null;
  const plan = overrideEffectivePlan || entitlementPlan || (grant ? 'pro' : profileTier) || 'free';
  const adminOverride = hasConexAccess({
    userId: auth.userId,
    email: auth.email,
    tier: profileTier,
  });

  return {
    userId: auth.userId,
    email: auth.email,
    plan,
    profileTier,
    hasPro: adminOverride || Boolean(grant) || ['admin', 'premium', 'pro', 'paid', 'weekly', 'monthly', 'promo_pro'].includes(plan.toLowerCase()),
    entitlementSource: normalizedAdminOverridePlan
      ? (normalizedAdminOverridePlan === 'free' ? 'none' : 'paid')
      : entitlementSource || (grant ? 'paid' : ['admin', 'premium', 'pro'].includes(String(profileTier || '').toLowerCase()) ? 'paid' : 'none'),
    entitlementEndsAt,
    adminOverridePlan: normalizedAdminOverridePlan,
    adminOverride,
  };
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const rule = findApiAccessRule(pathname) || findPageAccessRule(pathname);

  if (!rule) {
    return applyClickjackingHeaders(NextResponse.next());
  }

  const auth = await requireUserFromRequest(req);
  if (!auth.ok) return unauthorizedResponse(req, rule);

  if (rule.requirement === 'auth') {
    return applyProtectedHeaders(NextResponse.next());
  }

  const supabase = getServiceClient();
  if (!supabase && !hasConexAccess({ userId: auth.userId, email: auth.email, tier: null })) {
    const decision = evaluateAccess(
      {
        userId: auth.userId,
        email: auth.email,
        plan: 'free',
        adminOverride: false,
      },
      rule,
    );
    return forbiddenResponse(req, decision);
  }

  try {
    const subject = await loadMiddlewareSubject(supabase, auth);
    const decision = evaluateAccess(subject, rule);
    if (!decision.allowed) return forbiddenResponse(req, decision);
    return applyProtectedHeaders(NextResponse.next());
  } catch (error: any) {
    console.error('[middleware:authz] Failed to evaluate protected access:', {
      pathname,
      routeId: rule.id,
      message: String(error?.message || error),
      code: error?.code || null,
    });
    const decision = evaluateAccess(
      {
        userId: auth.userId,
        email: auth.email,
        plan: 'free',
        adminOverride: hasConexAccess({ userId: auth.userId, email: auth.email, tier: null }),
      },
      rule,
    );
    return forbiddenResponse(req, decision);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|workbox-.*\\.js|icons|apple-touch-icon.png|robots.txt|sitemap.xml).*)'],
};
