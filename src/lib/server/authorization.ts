import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest, type RequestAuthResult } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import {
  ACCESS_NO_STORE_HEADERS,
  buildFeatureAccessRule,
  evaluateAccess,
  type AccessDecision,
  type AccessRequirement,
  type AccessRule,
  type EntitlementSubject,
} from '@/lib/authz/access-control';
import { getEffectiveEntitlementsSnapshot } from '@/lib/server/effective-entitlements';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TierFeatureKey } from '@/lib/tier/policy';

export type AuthorizedRequest = {
  auth: Extract<RequestAuthResult, { ok: true }>;
  supabase: SupabaseClient;
  subject: EntitlementSubject;
  decision: AccessDecision;
};

export class AccessControlError extends Error {
  decision: AccessDecision;
  status: number;

  constructor(decision: AccessDecision) {
    super(decision.reason || decision.code || 'access_denied');
    this.name = 'AccessControlError';
    this.decision = decision;
    this.status = decision.status;
  }
}

function noStoreHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  for (const [key, value] of Object.entries(ACCESS_NO_STORE_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}

async function readProfileTier(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('au_user_profiles')
    .select('tier')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[authorization] profile tier lookup failed', {
      userId,
      code: (error as any)?.code || null,
      message: error.message,
    });
    return null;
  }
  return typeof (data as any)?.tier === 'string' ? (data as any).tier : null;
}

export async function loadEntitlementSubject(input: {
  supabase: SupabaseClient;
  auth: Extract<RequestAuthResult, { ok: true }>;
}): Promise<EntitlementSubject> {
  const [snapshot, profileTier] = await Promise.all([
    getEffectiveEntitlementsSnapshot(input.supabase, input.auth.userId),
    readProfileTier(input.supabase, input.auth.userId),
  ]);

  return {
    userId: input.auth.userId,
    email: input.auth.email,
    plan: snapshot.plan,
    profileTier,
    hasPro: snapshot.hasPro,
    entitlementSource: snapshot.entitlementSource,
    entitlementEndsAt: snapshot.entitlementEndsAt,
    promoActive: snapshot.promoActive,
    promoEndsAtUtc: snapshot.promoEndsAtUtc,
    adminOverridePlan: snapshot.adminOverridePlan,
    adminOverride: hasConexAccess({
      userId: input.auth.userId,
      email: input.auth.email,
      tier: profileTier,
    }),
  };
}

function unauthenticatedDecision(rule: Pick<AccessRule, 'id' | 'requirement' | 'feature' | 'labels'>): AccessDecision {
  return evaluateAccess(null, rule);
}

export async function authorizeRequest(
  req: NextRequest,
  rule: Pick<AccessRule, 'id' | 'requirement' | 'feature' | 'labels'>,
): Promise<AuthorizedRequest> {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    throw new AccessControlError(unauthenticatedDecision(rule));
  }

  const supabase = createSupabaseAdminClient();
  const subject = await loadEntitlementSubject({ supabase, auth });
  const decision = evaluateAccess(subject, rule);
  if (!decision.allowed) {
    throw new AccessControlError(decision);
  }

  return { auth, supabase, subject, decision };
}

export async function requireEntitlement(req: NextRequest, feature: TierFeatureKey): Promise<AuthorizedRequest> {
  return authorizeRequest(req, buildFeatureAccessRule(feature));
}

export async function requirePaidAccess(req: NextRequest): Promise<AuthorizedRequest> {
  return authorizeRequest(req, {
    id: 'paid_access',
    requirement: 'paid',
    labels: ['AUTH', 'PRO', 'PREMIUM', 'CACHE_SENSITIVE'],
  });
}

export async function requireAdmin(req: NextRequest): Promise<AuthorizedRequest> {
  return authorizeRequest(req, {
    id: 'admin_access',
    requirement: 'admin',
    labels: ['AUTH', 'ADMIN', 'STAFF', 'INTERNAL', 'CACHE_SENSITIVE'],
  });
}

export function accessControlResponse(error: AccessControlError, requestId?: string): NextResponse {
  const decision = error.decision;
  return NextResponse.json(
    {
      ok: false,
      code: decision.code || 'FORBIDDEN',
      message: decision.reason || 'Access denied.',
      feature: decision.feature || null,
      routeId: decision.routeId || null,
      upgradeUrl: decision.upgradeUrl || null,
      requestId,
    },
    {
      status: decision.status,
      headers: noStoreHeaders(),
    },
  );
}

export function isAccessControlError(error: unknown): error is AccessControlError {
  return error instanceof AccessControlError;
}

export function withNoStore(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(ACCESS_NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function buildRouteRule(input: {
  id: string;
  requirement: AccessRequirement;
  feature?: TierFeatureKey;
  labels?: AccessRule['labels'];
}): Pick<AccessRule, 'id' | 'requirement' | 'feature' | 'labels'> {
  return {
    id: input.id,
    requirement: input.requirement,
    feature: input.feature,
    labels: input.labels || ['AUTH', 'CACHE_SENSITIVE'],
  };
}
