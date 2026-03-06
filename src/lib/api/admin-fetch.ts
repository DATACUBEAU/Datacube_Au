import { safeFetch } from './safe-fetch';
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';
import { guardRequest } from './request-guard';
import { dispatchSessionExpired } from '@/lib/auth/session-expiry-events';

/**
 * Centralized utility for all admin-related API requests.
 * Automatically injects required Supabase and Admin authentication headers.
 */
export async function fetchAdmin(endpoint: string, options: RequestInit = {}) {
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  // Retrieve the admin token from secure storage (using localStorage for persistence across refreshes)
  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('conex_admin_token') : null;

  const online = typeof window === 'undefined' ? true : window.navigator.onLine;
  const gate = guardRequest({
    isOnline: online,
    requireAuth: false,
    allowOfflineRead: false,
    warnKey: 'admin:fetch',
    context: endpoint,
  });

  if (!gate.ok && gate.reason === 'offline') {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = endpoint.startsWith('http')
    ? endpoint
    : endpoint.startsWith('/api/')
      ? endpoint
      : `/api/proxy/${endpoint}`;

  const headers = new Headers(options.headers || {});
  const hadExplicitAuthorization = headers.has('Authorization');
  
  // 1. Default API Key
  if (ANON_KEY) {
    if (!headers.has('apikey')) headers.set('apikey', ANON_KEY);
  }

  const resolveAccessToken = async (): Promise<string | null> => {
    let token = await getSupabaseAccessToken();
    if (token) return token;

    try {
      await supabase.auth.getSession();
      await supabase.auth.refreshSession().catch(() => null);
      token = await getSupabaseAccessToken();
      if (token) return token;
    } catch {
    }

    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) {
        token = await getSupabaseAccessToken();
        if (token) return token;
      }
    } catch {
    }

    return null;
  };

  const executeWithToken = async (token: string) => {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Authorization', `Bearer ${token}`);
    return safeFetch(url, {
      ...options,
      headers: requestHeaders,
    });
  };

  // 2. Authorization: Require an authenticated Supabase user session
  let accessToken: string | null = null;
  if (hadExplicitAuthorization) {
    const auth = headers.get('Authorization');
    if (typeof auth === 'string' && auth.trim().length > 0) {
      accessToken = auth.toLowerCase().startsWith('bearer ')
        ? auth.slice('bearer '.length).trim()
        : auth.trim();
    }
  } else {
    accessToken = await resolveAccessToken();
    if (!accessToken) {
      dispatchSessionExpired({
        status: 401,
        source: 'fetchAdmin',
        reason: 'missing_access_token',
      });
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  if (!accessToken) {
    dispatchSessionExpired({
      status: 401,
      source: 'fetchAdmin',
      reason: 'no_resolved_access_token',
    });
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  
  if (!headers.has('X-Admin-Token') && adminToken) {
    headers.set('X-Admin-Token', adminToken);
  }

  let res = await executeWithToken(accessToken);

  // One retry for expired auth cookies/session.
  if (res.status === 401 && !hadExplicitAuthorization) {
    try {
      await supabase.auth.getSession();
      await supabase.auth.refreshSession();
      const refreshed = await getSupabaseAccessToken();
      if (refreshed) {
        accessToken = refreshed;
        res = await executeWithToken(accessToken);
      }
    } catch {
    }
  }

  if (res.status === 401 || res.status === 403) {
    dispatchSessionExpired({
      status: res.status,
      source: 'fetchAdmin',
      reason: 'admin_proxy_auth_error',
    });
  }

  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await res.clone().json().catch(() => null);
      if (json && typeof json === 'object') {
        Object.assign(res as any, json);
        (res as any).data = json;
      }
    }
  } catch {
  }

  return res;
}
