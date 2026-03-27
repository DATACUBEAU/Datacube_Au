import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

type AuthSuccess = {
  ok: true;
  accessToken: string;
  userId: string;
  email: string | null;
  source: 'header' | 'cookie';
  diagnostics: RequestAuthDiagnostics;
};

type AuthFailure = {
  ok: false;
  status: 401;
  error: 'unauthorized';
  reason: 'missing_token' | 'invalid_token';
  debug?: string; // For diagnostics
  diagnostics: RequestAuthDiagnostics;
};

export type RequestAuthResult = AuthSuccess | AuthFailure;

export type RequestAuthDiagnostics = {
  hasAuthorizationHeader: boolean;
  hasAuthCookie: boolean;
  attemptedSources: Array<'header' | 'cookie'>;
  failedSources: Array<'header' | 'cookie'>;
  validatedSource: 'header' | 'cookie' | null;
};

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  return null;
}

function safeJsonParse(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeBase64Flexible(raw: string): string | null {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

function normalizeBearerToken(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const token = lower.startsWith('bearer ') ? trimmed.slice('bearer '.length).trim() : trimmed;
  if (!token) return null;
  const tokenLower = token.toLowerCase();
  if (tokenLower === 'undefined' || tokenLower === 'null') return null;
  return token;
}

function extractAccessTokenFromCookieValue(rawValue: string): string | null {
  const decoded = safeDecodeURIComponent(rawValue);
  const parsed = safeJsonParse(decoded);
  if (parsed && typeof parsed === 'object') {
    if (typeof (parsed as any).access_token === 'string' && (parsed as any).access_token) {
      return (parsed as any).access_token;
    }
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0]) {
      return parsed[0];
    }
  }

  const b64Parsed = decoded.startsWith('base64-') ? decoded.slice('base64-'.length) : decoded;
  if (b64Parsed) {
    const decodedB64 = decodeBase64Flexible(b64Parsed);
    if (decodedB64) {
      const parsed2 = safeJsonParse(decodedB64);
      if (parsed2 && typeof parsed2 === 'object') {
        if (typeof (parsed2 as any).access_token === 'string' && (parsed2 as any).access_token) {
          return (parsed2 as any).access_token;
        }
        if (Array.isArray(parsed2) && typeof parsed2[0] === 'string' && parsed2[0]) {
          return parsed2[0];
        }
      }
    }
  }

  if (decoded && decoded.includes('.') && decoded.split('.').length >= 3) return decoded;
  return null;
}

function inspectAuthCookies(req: NextRequest): { hasAuthCookie: boolean; accessToken: string | null } {
  const cookies = req.cookies.getAll();
  const groups = new Map<string, Array<{ name: string; value: string; index: number | null }>>();
  let hasAuthCookie = false;
  for (const c of cookies) {
    const nameLower = c.name.toLowerCase();
    const baseName = nameLower.replace(/\.\d+$/, '');
    const isAuthCookie =
      baseName === 'sb-access-token' ||
      baseName === 'access_token' ||
      baseName === 'supabase-auth-token' ||
      baseName.endsWith('-auth-token') ||
      (baseName.includes('supabase') && baseName.includes('auth'));
    if (!isAuthCookie) continue;
    hasAuthCookie = true;

    const match = nameLower.match(/\.(\d+)$/);
    const index = match ? Number(match[1]) : null;
    const parts = groups.get(baseName) ?? [];
    parts.push({ name: nameLower, value: c.value, index: Number.isFinite(index) ? index : null });
    groups.set(baseName, parts);
  }

  for (const parts of groups.values()) {
    const hasIndexes = parts.some((p) => typeof p.index === 'number');
    const combined = hasIndexes
      ? parts
          .slice()
          .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
          .map((p) => p.value)
          .join('')
      : parts[0]?.value ?? '';

    const token = combined ? extractAccessTokenFromCookieValue(combined) : null;
    if (!token) continue;
    const normalized = normalizeBearerToken(token);
    if (normalized) {
      return {
        hasAuthCookie,
        accessToken: normalized,
      };
    }
  }
  return {
    hasAuthCookie,
    accessToken: null,
  };
}

async function validateAccessToken(token: string): Promise<{ userId: string; email: string | null } | null> {
  const supabaseUrl = firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const anonKey = firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return null;

  const supabase = createClient(
    supabaseUrl,
    anonKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) {
    // Enhanced diagnostic logging
    console.warn('[proxy] validateAccessToken failed:', {
      error: error?.message || 'missing_user_id',
      errorCode: (error as any)?.code || (error as any)?.status || 'unknown',
      tokenPreview: `${token.slice(0, 8)}...${token.slice(-8)}`,
      tokenLength: token.length,
      hasData: !!data,
      hasUser: !!data?.user,
    });
    return null;
  }
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
  };
}

export async function requireUserFromRequest(req: NextRequest): Promise<RequestAuthResult> {
  const headerToken = normalizeBearerToken(req.headers.get('authorization'));
  const cookieInspection = inspectAuthCookies(req);
  const cookieToken = cookieInspection.accessToken;
  const diagnostics: RequestAuthDiagnostics = {
    hasAuthorizationHeader: Boolean(req.headers.get('authorization')),
    hasAuthCookie: cookieInspection.hasAuthCookie,
    attemptedSources: [],
    failedSources: [],
    validatedSource: null,
  };

  const candidates: Array<{ token: string; source: 'header' | 'cookie' }> = [];
  if (cookieToken) candidates.push({ token: cookieToken, source: 'cookie' });
  if (headerToken) candidates.push({ token: headerToken, source: 'header' });

  if (candidates.length === 0) {
    console.warn('[proxy] no auth tokens found in request', {
      hasCookie: diagnostics.hasAuthCookie,
      hasAuthHeader: diagnostics.hasAuthorizationHeader,
    });
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      reason: 'missing_token',
      diagnostics,
    };
  }

  let debugMessage = '';
  const seenTokens = new Set<string>();

  for (const { token, source } of candidates) {
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);
    diagnostics.attemptedSources.push(source);

    const validation = await validateAccessToken(token);
    if (!validation?.userId) {
      diagnostics.failedSources.push(source);
      const msg = `Validation failed for ${source} token: ${token.slice(0, 10)}...`;
      if (!debugMessage) debugMessage = msg;
      continue;
    }

    diagnostics.validatedSource = source;
    return {
      ok: true,
      accessToken: token,
      userId: validation.userId,
      email: validation.email,
      source: source,
      diagnostics,
    };
  }

  // Token was present but invalid/expired
  console.warn('[proxy] all provided tokens failed validation', {
    candidateCount: candidates.length,
    sources: candidates.map(c => c.source),
    debug: debugMessage
  });

  return { 
    ok: false, 
    status: 401, 
    error: 'unauthorized', 
    reason: 'invalid_token',
    debug: debugMessage || 'All provided tokens failed validation.',
    diagnostics,
  };
}
