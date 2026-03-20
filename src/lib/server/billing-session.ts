import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { firstEnv } from './env';

export const BILLING_PLAN_SESSION_COOKIE = 'dcau-billing-plan';
export const BILLING_ACTION_TOKEN_HEADER = 'x-billing-request-token';
export const BILLING_PLAN_CHECKSUM_HEADER = 'x-billing-plan-checksum';

const BILLING_ACTION_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const BILLING_PLAN_SESSION_MAX_AGE_SECONDS = 5 * 60;

type NextRequestLike = {
  headers: {
    get: (name: string) => string | null;
  };
};

type NextResponseLike = {
  cookies: {
    set: (name: string, value: string, options: Record<string, unknown>) => void;
  };
  headers: {
    set: (name: string, value: string) => void;
  };
};

export type BillingPlanSnapshot = {
  userId: string;
  managedPlan: string;
  activePlanKey: string | null;
  entitlementSource: string;
  expiresAt: string | null;
  hasPaidEntitlement: boolean;
  checksum: string;
  issuedAt: string;
};

type SignedBillingTokenPayload = {
  kind: 'billing-action' | 'billing-plan';
  userId: string;
  checksum: string;
  issuedAt: number;
  managedPlan: string;
  activePlanKey: string | null;
  entitlementSource: string;
  expiresAt: string | null;
  hasPaidEntitlement: boolean;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join('|')}}`;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function billingSigningSecret(): string {
  return (
    firstEnv(
      'BILLING_SESSION_SECRET',
      'PAYSTACK_SECRET_KEY',
      'PAYSTACK_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
    ) || 'datacube-au-billing-session-fallback'
  );
}

function signTokenPayload(payload: string): string {
  return createHmac('sha256', billingSigningSecret()).update(payload).digest('base64url');
}

function timingSafeCompare(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createBillingPlanChecksum(input: Omit<BillingPlanSnapshot, 'checksum' | 'issuedAt'>): string {
  return createHash('sha256').update(stableStringify(input), 'utf8').digest('hex');
}

export function buildBillingPlanSnapshot(input: {
  userId: string;
  status: Record<string, unknown>;
}): BillingPlanSnapshot {
  const currentPlan = ((input.status.currentPlan || {}) as Record<string, unknown>) || {};
  const base = {
    userId: input.userId,
    managedPlan: String(currentPlan.managedPlan || input.status.tier || 'free'),
    activePlanKey:
      typeof currentPlan.activePlanKey === 'string' && currentPlan.activePlanKey.trim()
        ? currentPlan.activePlanKey
        : null,
    entitlementSource: String(input.status.entitlementSource || currentPlan.entitlementSource || 'none'),
    expiresAt:
      typeof input.status.tier_expires_at === 'string' && String(input.status.tier_expires_at).trim()
        ? String(input.status.tier_expires_at)
        : null,
    hasPaidEntitlement: currentPlan.hasPaidEntitlement === true,
  };

  return {
    ...base,
    checksum: createBillingPlanChecksum(base),
    issuedAt: new Date().toISOString(),
  };
}

function issueSignedToken(kind: SignedBillingTokenPayload['kind'], snapshot: BillingPlanSnapshot): string {
  const payload: SignedBillingTokenPayload = {
    kind,
    userId: snapshot.userId,
    checksum: snapshot.checksum,
    issuedAt: Date.now(),
    managedPlan: snapshot.managedPlan,
    activePlanKey: snapshot.activePlanKey,
    entitlementSource: snapshot.entitlementSource,
    expiresAt: snapshot.expiresAt,
    hasPaidEntitlement: snapshot.hasPaidEntitlement,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${signTokenPayload(encoded)}`;
}

export function attachBillingSessionArtifacts(
  response: NextResponseLike,
  snapshot: BillingPlanSnapshot,
): { requestToken: string } {
  const planToken = issueSignedToken('billing-plan', snapshot);
  response.cookies.set(BILLING_PLAN_SESSION_COOKIE, planToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: BILLING_PLAN_SESSION_MAX_AGE_SECONDS,
  });
  response.headers.set(BILLING_PLAN_CHECKSUM_HEADER, snapshot.checksum);
  return {
    requestToken: issueSignedToken('billing-action', snapshot),
  };
}

export function readBillingActionSignature(input: {
  req: NextRequestLike;
  userId: string;
}): { valid: boolean; checksum: string | null } {
  const token = input.req.headers.get(BILLING_ACTION_TOKEN_HEADER);
  const checksumHeader = input.req.headers.get(BILLING_PLAN_CHECKSUM_HEADER);
  if (!token || !checksumHeader) {
    return { valid: false, checksum: null };
  }

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) {
    return { valid: false, checksum: null };
  }
  if (!timingSafeCompare(signTokenPayload(encoded), signature)) {
    return { valid: false, checksum: null };
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as SignedBillingTokenPayload;
    if (parsed.kind !== 'billing-action') return { valid: false, checksum: null };
    if (parsed.userId !== input.userId) return { valid: false, checksum: null };
    if (parsed.checksum !== checksumHeader) return { valid: false, checksum: null };
    if (Date.now() - Number(parsed.issuedAt || 0) > BILLING_ACTION_TOKEN_MAX_AGE_MS) {
      return { valid: false, checksum: null };
    }
    return { valid: true, checksum: parsed.checksum };
  } catch {
    return { valid: false, checksum: null };
  }
}
