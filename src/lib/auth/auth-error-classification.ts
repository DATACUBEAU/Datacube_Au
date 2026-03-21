import { extractApiError, normalizeApiErrorCode } from '../api/api-contract';

type UnknownRecord = Record<string, unknown>;

export type AuthFailureDescriptor = {
  status: 401 | 403;
  code: 'UNAUTHORIZED' | 'FORBIDDEN';
  message: 'Authentication failed.' | 'Forbidden.';
  reason: string;
  originalCode: string | null;
};

const AUTHENTICATION_CODES = new Set([
  'UNAUTHORIZED',
  'AUTH_REQUIRED',
  'AUTHENTICATION_FAILED',
  'INVALID_TOKEN',
  'MISSING_TOKEN',
  'SESSION_EXPIRED',
  'REAUTH_REQUIRED',
  'LOGIN_REQUIRED',
]);

const AUTHORIZATION_CODES = new Set([
  'FORBIDDEN',
  'ACCESS_DENIED',
  'PERMISSION_DENIED',
  'INSUFFICIENT_PERMISSIONS',
  'TIER_ACCESS_DENIED',
]);

const AUTHENTICATION_PATTERNS = [
  /\bunauthorized\b/i,
  /\bauth(?:entication)?[_ -]?required\b/i,
  /\bauthentication failed\b/i,
  /\bsession expired\b/i,
  /\bre-?authentication required\b/i,
  /\bre-?login required\b/i,
  /\bsign in required\b/i,
  /\bmissing token\b/i,
  /\binvalid token\b/i,
  /\bnot authenticated\b/i,
];

const AUTHORIZATION_PATTERNS = [
  /\bforbidden\b/i,
  /\baccess denied\b/i,
  /\bpermission denied\b/i,
  /\binsufficient permission/i,
  /\bnot allowed\b/i,
];

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushFragment(out: string[], value: unknown) {
  if (typeof value !== 'string') return;
  const normalized = value.trim();
  if (!normalized) return;
  out.push(normalized.slice(0, 240));
}

function collectTextFragments(value: unknown, out: string[] = [], depth = 0): string[] {
  if (out.length >= 24 || depth > 3 || value == null) return out;

  if (typeof value === 'string') {
    pushFragment(out, value);
    return out;
  }

  if (value instanceof Error) {
    pushFragment(out, value.name);
    pushFragment(out, value.message);
    collectTextFragments((value as any).code, out, depth + 1);
    collectTextFragments((value as any).details, out, depth + 1);
    collectTextFragments((value as any).reason, out, depth + 1);
    return out;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 8)) {
      collectTextFragments(entry, out, depth + 1);
      if (out.length >= 24) break;
    }
    return out;
  }

  if (isRecord(value)) {
    const preferredKeys = ['code', 'error', 'message', 'details', 'reason', 'statusText', 'name'];
    for (const key of preferredKeys) {
      if (!(key in value)) continue;
      collectTextFragments(value[key], out, depth + 1);
      if (out.length >= 24) return out;
    }

    for (const entry of Object.values(value).slice(0, 8)) {
      collectTextFragments(entry, out, depth + 1);
      if (out.length >= 24) break;
    }
  }

  return out;
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function inferReason(status: 401 | 403, text: string, explicitReason: string | null): string {
  if (explicitReason) {
    return explicitReason.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || (status === 401 ? 'unauthorized' : 'forbidden');
  }

  if (status === 401) {
    if (/missing token/i.test(text)) return 'missing_token';
    if (/invalid token/i.test(text)) return 'invalid_token';
    if (/session expired|re-?authentication required|re-?login required/i.test(text)) return 'session_expired';
    if (/sign in required/i.test(text)) return 'sign_in_required';
    return 'unauthorized';
  }

  if (/permission denied/i.test(text)) return 'permission_denied';
  if (/access denied/i.test(text)) return 'access_denied';
  return 'forbidden';
}

export function classifyAuthFailure(input: unknown): AuthFailureDescriptor | null {
  const parsed = extractApiError(input, '');
  const detailsRecord = isRecord(parsed.details) ? parsed.details : null;
  const rootRecord = isRecord(input) ? input : null;
  const originalCodeRaw =
    typeof parsed.code === 'string' && parsed.code.trim()
      ? parsed.code
      : typeof rootRecord?.code === 'string'
        ? rootRecord.code
        : typeof rootRecord?.error === 'string'
          ? rootRecord.error
          : '';
  const originalCode = originalCodeRaw ? normalizeApiErrorCode(originalCodeRaw, '') : null;
  const fragments = collectTextFragments(input);
  collectTextFragments(parsed.message, fragments);
  collectTextFragments(parsed.details, fragments);
  const text = fragments.join(' | ').toLowerCase();

  const hasAuthenticationCode = Boolean(originalCode && AUTHENTICATION_CODES.has(originalCode));
  const hasAuthorizationCode = Boolean(originalCode && AUTHORIZATION_CODES.has(originalCode));
  const hasAuthenticationText = matchesAnyPattern(text, AUTHENTICATION_PATTERNS);
  const hasAuthorizationText = matchesAnyPattern(text, AUTHORIZATION_PATTERNS);
  const statusHint = typeof parsed.status === 'number' && Number.isFinite(parsed.status) ? parsed.status : null;

  const isAuthenticationFailure =
    statusHint === 401 ||
    hasAuthenticationCode ||
    (hasAuthenticationText && !hasAuthorizationCode);

  const isAuthorizationFailure =
    statusHint === 403 ||
    hasAuthorizationCode ||
    (!isAuthenticationFailure && hasAuthorizationText);

  if (!isAuthenticationFailure && !isAuthorizationFailure) {
    return null;
  }

  const status: 401 | 403 = isAuthenticationFailure ? 401 : 403;
  const explicitReason =
    typeof detailsRecord?.reason === 'string'
      ? detailsRecord.reason
      : typeof rootRecord?.reason === 'string'
        ? rootRecord.reason
        : null;

  return {
    status,
    code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
    message: status === 401 ? 'Authentication failed.' : 'Forbidden.',
    reason: inferReason(status, text, explicitReason),
    originalCode,
  };
}

export function isAuthenticationFailure(input: unknown): boolean {
  return classifyAuthFailure(input)?.status === 401;
}

export function isAuthorizationFailure(input: unknown): boolean {
  return classifyAuthFailure(input)?.status === 403;
}
