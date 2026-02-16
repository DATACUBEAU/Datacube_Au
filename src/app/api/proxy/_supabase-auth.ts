import type { NextRequest } from 'next/server';

export type SupabaseAuthExtraction = {
  authorizationHeader: string | null;
  hadAuthInput: boolean;
};

function safeJsonParse(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function normalizeBearerHeader(value: string): { header: string | null; token: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { header: null, token: null };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('bearer ')) {
    const token = trimmed.slice('bearer '.length).trim();
    if (!token) return { header: null, token: null };
    return { header: `Bearer ${token}`, token };
  }
  return { header: trimmed, token: null };
}

function isInvalidTokenLiteral(token: string): boolean {
  const t = token.trim().toLowerCase();
  return t === 'undefined' || t === 'null' || t === '';
}

export function extractSupabaseAuthorization(req: NextRequest): SupabaseAuthExtraction {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.trim()) {
    const normalized = normalizeBearerHeader(authHeader);
    const tokenToCheck = normalized.token ?? null;
    if (tokenToCheck && (isInvalidTokenLiteral(tokenToCheck) || (!!anonKey && tokenToCheck === anonKey))) {
      return { authorizationHeader: null, hadAuthInput: true };
    }
    return { authorizationHeader: normalized.header, hadAuthInput: true };
  }

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
      if (isInvalidTokenLiteral(token)) return { authorizationHeader: null, hadAuthInput: true };
      if (!!anonKey && token === anonKey) return { authorizationHeader: null, hadAuthInput: true };
      return { authorizationHeader: `Bearer ${token}`, hadAuthInput: true };
    }
  }

  return { authorizationHeader: null, hadAuthInput: false };
}
