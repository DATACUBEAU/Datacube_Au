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

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'unknown';
  const k = "dcau_device_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(k, v);
  }
  return v;
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
  
  // Inject x-device-id
  const deviceId = getDeviceId();
  headers.set('x-device-id', deviceId);

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



// Guest token functionality
export function getGuestToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('guest_token');
  if (!token) return null;

  // Check expiration
  const decoded = decodeJWT(token);
  if (decoded?.exp) {
    const now = Math.floor(Date.now() / 1000);
    // Add 10 second buffer
    if (decoded.exp < now + 10) {
      console.warn('[client] Guest token expired, clearing');
      localStorage.removeItem('guest_token');
      return null;
    }
  }
  
  return token;
}

export function setGuestToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('guest_token', token);
}

export function clearGuestToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('guest_token');
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
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const response = await safeFetch(`${SUPABASE_URL}/functions/v1/guest-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
      },
      body: JSON.stringify({}),
    });

    const data = await response.json();
    const accessToken = (data as any)?.token || (data as any)?.access_token;
    const sessionId = (data as any)?.session_id;

    if (accessToken) {
      setGuestToken(accessToken);
      const decoded = decodeJWT(accessToken);
      return decoded?.guest_session_id || decoded?.sub || sessionId || '';
    }

    if (sessionId) return String(sessionId);
  } catch (e) {
    console.error('[client] Failed to create guest session:', e);
  }
  return '';
}

/**
 * Updates the last_active_at timestamp and device info for the current user or guest.
 */
export async function updateUserActivity(
  user: User | null,
  opts?: { isOnline?: boolean }
): Promise<void> {
  try {
    const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
    const isInstalled = typeof window !== 'undefined' && (window.navigator as any).standalone || isStandalone;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    const isOnline = typeof opts?.isOnline === 'boolean' ? opts.isOnline : (typeof navigator !== 'undefined' ? navigator.onLine : true);

    const { getDeviceInfo } = await import('@/lib/device/device-info');
    let deviceInfo: any = null;
    try {
      deviceInfo = await getDeviceInfo();
    } catch {
      deviceInfo = null;
    }
    
    // Detailed Device Context
    const metadata = {
      pwa: {
        isStandalone,
        isInstalled,
        displayMode: isStandalone ? 'standalone' : 'browser'
      },
      device: {
        browser: userAgent,
        browserName: deviceInfo?.browserName || 'unknown',
        browserVersion: deviceInfo?.browserVersion || '',
        platform: deviceInfo?.platform || (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
        osName: deviceInfo?.osName || 'unknown',
        osVersion: deviceInfo?.osVersion || '',
        deviceModel: deviceInfo?.deviceModel || 'unknown',
        deviceType: deviceInfo?.deviceType || 'unknown',
        language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
        timeZone: deviceInfo?.timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'unknown'),
        isMobile: deviceInfo?.deviceType ? (deviceInfo.deviceType === 'mobile' || deviceInfo.deviceType === 'tablet') : /iPhone|iPad|iPod|Android/i.test(userAgent),
        screen: deviceInfo?.screenResolution || (typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'unknown')
      },
      connection: {
        isOnline,
        checked_at: new Date().toISOString(),
        navigator_onLine: typeof navigator !== 'undefined' ? navigator.onLine : true
      },
      updated_at: new Date().toISOString()
    };

    if (user?.id) {
      const { error } = await supabase
        .from('au_user_activity')
        .upsert({ 
          user_id: user.id, 
          last_active_at: new Date().toISOString(),
          user_agent: userAgent,
          is_pwa: isStandalone,
          metadata: metadata
        }, { onConflict: 'user_id' });
        
      if (error && error.code !== '406') {
          console.warn('[client] Activity update error:', error);
      }
    } else {
      const guestId = await ensureGuestSession();
      if (guestId) {
        await supabase
          .from('au_guest_sessions')
          .update({ 
            last_active_at: new Date().toISOString(),
            user_agent: userAgent,
            is_pwa: isStandalone,
            metadata: metadata
          })
          .eq('id', guestId);
      }
    }
  } catch (e) {
    console.warn('[client] Failed to update activity:', e);
  }
}
