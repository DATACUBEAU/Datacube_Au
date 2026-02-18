import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

type AuthSuccess = {
  ok: true;
  accessToken: string;
  userId: string;
  source: 'header' | 'cookie';
};

type AuthFailure = {
  ok: false;
  status: 401;
  error: 'unauthorized';
  reason: 'missing_token' | 'invalid_token';
};

export type RequestAuthResult = AuthSuccess | AuthFailure;

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function safeJsonParse(value: string): any | null {
  try {
    return JSON.parse(value);
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
  const decoded = decodeURIComponent(rawValue);
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
  if (b64Parsed && /^[A-Za-z0-9+/=]+$/.test(b64Parsed)) {
    try {
      const json = atob(b64Parsed);
      const parsed2 = safeJsonParse(json);
      if (parsed2 && typeof parsed2 === 'object') {
        if (typeof (parsed2 as any).access_token === 'string' && (parsed2 as any).access_token) {
          return (parsed2 as any).access_token;
        }
        if (Array.isArray(parsed2) && typeof parsed2[0] === 'string' && parsed2[0]) {
          return parsed2[0];
        }
      }
    } catch {
    }
  }

  if (decoded && decoded.includes('.') && decoded.split('.').length >= 3) return decoded;
  return null;
}

function extractAccessTokenFromCookies(req: NextRequest): string | null {
  const cookies = req.cookies.getAll();
  for (const c of cookies) {
    const name = c.name.toLowerCase();
    if (
      name === 'sb-access-token' ||
      name === 'access_token' ||
      name === 'supabase-auth-token' ||
      name.endsWith('-auth-token') ||
      (name.includes('supabase') && name.includes('auth'))
    ) {
      const token = extractAccessTokenFromCookieValue(c.value);
      if (!token) continue;
      const normalized = normalizeBearerToken(token);
      if (normalized) return normalized;
    }
  }
  return null;
}

async function validateAccessToken(token: string): Promise<{ userId: string } | null> {
  const supabase = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return { userId: data.user.id };
}

export async function requireUserFromRequest(req: NextRequest): Promise<RequestAuthResult> {
  const headerToken = normalizeBearerToken(req.headers.get('authorization'));
  const cookieToken = extractAccessTokenFromCookies(req);
  const token = headerToken ?? cookieToken;

  if (!token) {
    return { ok: false, status: 401, error: 'unauthorized', reason: 'missing_token' };
  }

  const validation = await validateAccessToken(token);
  if (!validation?.userId) {
    return { ok: false, status: 401, error: 'unauthorized', reason: 'invalid_token' };
  }

  return {
    ok: true,
    accessToken: token,
    userId: validation.userId,
    source: headerToken ? 'header' : 'cookie',
  };
}
