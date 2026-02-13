import { safeFetch } from './safe-fetch';

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
  headers.set('Authorization', `Bearer ${ANON_KEY}`);
  headers.set('Content-Type', 'application/json');
  
  if (adminToken) {
    headers.set('X-Admin-Token', adminToken);
  }

  return safeFetch(url, {
    ...options,
    headers,
  });
}
