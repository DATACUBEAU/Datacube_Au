import { safeFetch } from './safe-fetch';
import { supabase } from '@/lib/supabase-client/client';

/**
 * Centralized utility for all admin-related API requests.
 * Automatically injects required Supabase and Admin authentication headers.
 */
export async function fetchAdmin(endpoint: string, options: RequestInit = {}) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  // Retrieve the admin token from secure storage (using localStorage for persistence across refreshes)
  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('conex_admin_token') : null;

  const url = endpoint.startsWith('http') ? endpoint : `${SUPABASE_URL}/functions/v1/${endpoint}`;

  const headers = new Headers(options.headers || {});
  
  // 1. Default API Key
  if (ANON_KEY) {
    if (!headers.has('apikey')) headers.set('apikey', ANON_KEY);
  }

  // 2. Authorization: Prefer User Session, fallback to Anon
  if (!headers.has('Authorization')) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
          headers.set('Authorization', `Bearer ${session.access_token}`);
      } else if (ANON_KEY) {
          headers.set('Authorization', `Bearer ${ANON_KEY}`);
      }
  }

  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  
  if (!headers.has('X-Admin-Token') && adminToken) {
    headers.set('X-Admin-Token', adminToken);
  }

  const res = await safeFetch(url, {
    ...options,
    headers,
  });

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
