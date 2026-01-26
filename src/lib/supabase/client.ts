import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_BUCKET: process.env.NEXT_PUBLIC_SUPABASE_BUCKET,
} as const;

type PublicEnvKey = keyof typeof publicEnv;

function requiredEnv(key: PublicEnvKey): string {
  const value = publicEnv[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL || '';
  const isSupabaseRequest = supabaseUrl && url.includes(supabaseUrl);
  
  if (!isSupabaseRequest) {
    return fetch(input, init);
  }

  // Clone init to avoid mutating the original
  const newInit = { ...init };
  const headers = new Headers(newInit.headers);
  
  // If input is a Request, we need to be careful. 
  // Standard fetch behavior: if init.headers is present, it REPLACES input.headers.
  if (input instanceof Request) {
    try {
      input.headers.forEach((value, key) => {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      });
    } catch (e) {
      console.warn('[customFetch] Error merging request headers:', e);
    }
  }

  const guestToken = getGuestToken();
  const currentAuth = headers.get('Authorization');
  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  const validGuestToken = guestToken && guestToken !== 'undefined' && guestToken !== 'null' ? guestToken : null;

  // Only inject guest token if it's an anonymous request or missing auth
  const isAnonOrMissing = !currentAuth || currentAuth === `Bearer ${anonKey}`;
  const isNotAuth = !url.includes('/auth/v1/');
  
  if (validGuestToken && isAnonOrMissing && isNotAuth) {
    headers.set('Authorization', `Bearer ${validGuestToken}`);
  }
  
  if (!headers.has('apikey') && anonKey) {
    headers.set('apikey', anonKey);
  }

  // Ensure Authorization header doesn't have double "Bearer" or "Bearer undefined"
  const finalAuth = headers.get('Authorization');
  if (finalAuth) {
    if (finalAuth.startsWith('Bearer Bearer ')) {
      headers.set('Authorization', finalAuth.replace('Bearer Bearer ', 'Bearer '));
    } else if (finalAuth === 'Bearer undefined' || finalAuth === 'Bearer null' || finalAuth === 'Bearer ') {
      headers.delete('Authorization');
    }
  }

  // CRITICAL: For multipart/form-data (FormData body), we MUST NOT set Content-Type header manually.
  // The browser needs to set it with the correct boundary string.
  const contentType = headers.get('content-type');
  const isMultipart = contentType?.includes('multipart/form-data');
  const isFormData = newInit.body instanceof FormData || isMultipart;
  
  if (isFormData) {
    headers.delete('Content-Type');
  }

  newInit.headers = headers;

  // Use the original Request object if available to preserve body and other settings
  const fetchInput = input;

  try {
    const response = await fetch(fetchInput, newInit);
    return response;
  } catch (err: any) {
    console.error(`[customFetch] Network error fetching ${url}:`, {
      name: err?.name,
      message: err?.message,
      url: url
    });
    throw err;
  }
};

export function createBrowserSupabaseClient(): SupabaseClient {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    global: {
      fetch: customFetch,
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = createBrowserSupabaseClient();

// Guest token functionality (Cookie-based for SSR support)
const GUEST_TOKEN_KEY = 'guest_token';

export function getGuestToken(): string | null {
  if (typeof window === 'undefined') return null;
  
  // Try cookie first
  const name = GUEST_TOKEN_KEY + "=";
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) === 0) {
      return c.substring(name.length, c.length);
    }
  }

  // Fallback to localStorage for migration
  const legacyToken = localStorage.getItem(GUEST_TOKEN_KEY);
  if (legacyToken) {
    setGuestToken(legacyToken); // Migrate to cookie
    localStorage.removeItem(GUEST_TOKEN_KEY);
    return legacyToken;
  }

  return null;
}

export function setGuestToken(token: string): void {
  if (typeof window === 'undefined') return;
  
  // Set cookie with 1 year expiry
  const d = new Date();
  d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
  const expires = "expires=" + d.toUTCString();
  document.cookie = `${GUEST_TOKEN_KEY}=${token};${expires};path=/;SameSite=Lax`;
}

export function clearGuestToken(): void {
  if (typeof window === 'undefined') return;
  document.cookie = `${GUEST_TOKEN_KEY}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  localStorage.removeItem(GUEST_TOKEN_KEY);
}

export function decodeJWT(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/**
 * Returns a filter string for manual ownership filtering in Supabase queries.
 * Handles both authenticated users and guest sessions.
 */
export async function getEffectiveOwnershipConditions(user: User | null): Promise<string> {
  // Prioritize authenticated user ID. 
  // If the user is logged in (including anonymously), we prefer their user_id.
  // This prevents 400 errors from ORing user_id and guest_session_id when both are present.
  if (user?.id) {
    return `user_id.eq.${user.id}`;
  }

  // Fallback to guest session if no user is present
  const guestToken = getGuestToken();
  if (guestToken) {
    try {
      const decoded = decodeJWT(guestToken);
      const guestId = decoded?.guest_session_id || decoded?.sub;
      if (guestId) {
        return `guest_session_id.eq.${guestId}`;
      }
    } catch (e) {
      console.warn('[client] Failed to decode guest token in ownership check');
    }
  }

  // Fallback if no conditions found (though unlikely for a valid request)
  // If we have no user and no guest token, we return a filter that matches nothing
  // This is safer than returning a broad filter that might expose data.
  return 'id.eq.00000000-0000-0000-0000-000000000000'; 
}

/**
 * Helper to apply ownership filters consistently to a PostgREST query.
 * Correctly handles single vs multiple conditions to avoid PostgREST 400 errors.
 */
export function applyOwnershipFilter(query: any, conditions: string) {
  if (!conditions) return query;
  
  const trimmed = conditions.trim();
  if (trimmed.includes(',')) {
    return query.or(trimmed);
  }
  
  // Handle single condition like "user_id.eq.xxx"
  // We use .eq() instead of .or() for better compatibility and performance
  const [col, val] = trimmed.split('.eq.');
  if (col && val) {
    return query.eq(col, val);
  }
  
  // Fallback to .or() if it doesn't match the .eq. pattern
  return query.or(trimmed);
}

export async function ensureGuestSession(): Promise<string> {
  const token = getGuestToken();
  if (token) {
    const decoded = decodeJWT(token);
    const guestId = decoded?.guest_session_id || decoded?.sub;
    if (guestId) return guestId;
  }

  // If no token or invalid, create new via Edge Function
  try {
    const { safeFetch } = await import('@/lib/api/safe-fetch');
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const data = await safeFetch(`${SUPABASE_URL}/functions/v1/guest-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (data?.token) {
      setGuestToken(data.token);
      const decoded = decodeJWT(data.token);
      return decoded?.guest_session_id || decoded?.sub;
    }
  } catch (e) {
    console.error('[client] Failed to create guest session:', e);
  }
  return '';
}

/**
 * Updates the last_active_at timestamp and optional metadata for the current user or guest.
 */
export async function updateUserActivity(user: User | null, metadata?: any): Promise<void> {
  try {
    if (user?.id) {
      // For authenticated users
      const updates: any = { user_id: user.id, last_active_at: new Date().toISOString() };
      if (metadata) {
        // Merge with existing metadata if possible
        const { data: current } = await supabase
          .from('au_user_activity')
          .select('metadata')
          .eq('user_id', user.id)
          .single();
        
        updates.metadata = { ...(current?.metadata || {}), ...metadata };
      }
      await supabase
        .from('au_user_activity')
        .upsert(updates, { onConflict: 'user_id' });
    } else {
      // For guest users
      const guestId = await ensureGuestSession();
      if (guestId) {
        const { safeFetch } = await import('@/lib/api/safe-fetch');
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
        await safeFetch(`${SUPABASE_URL}/functions/v1/guest-session`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            action: 'heartbeat', 
            guestId,
            ...(metadata ? { metadata } : {})
          }),
        });
      }
    }
  } catch (e) {
    // Fail silently to not disrupt the user experience
    console.warn('[client] Failed to update activity:', e);
  }
}

/**
 * Fetches the current user activity or guest session metadata.
 */
export async function fetchUserMetadata(user: User | null): Promise<any> {
  try {
    if (user?.id) {
      const { data, error } = await supabase
        .from('au_user_activity')
        .select('metadata')
        .eq('user_id', user.id)
        .single();
      if (error) throw error;
      return data?.metadata || {};
    } else {
      const guestId = await ensureGuestSession();
      if (guestId) {
        const { data, error } = await supabase
          .from('au_guest_sessions')
          .select('metadata')
          .eq('id', guestId)
          .single();
        if (error) throw error;
        return data?.metadata || {};
      }
    }
  } catch (e) {
    console.warn('[client] Failed to fetch user metadata:', e);
  }
  return {};
}
