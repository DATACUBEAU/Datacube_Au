import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { safeFetch, OfflineError } from '@/lib/api/safe-fetch';

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

  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
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

function supabaseProjectRefFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (!host.endsWith('.supabase.co')) return null;
    const ref = host.replace('.supabase.co', '');
    return ref || null;
  } catch {
    return null;
  }
}

function tokenProjectRefFromAccessToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;
    const payloadRaw = parts[1];
    const base64 = payloadRaw.replace(/-/g, '+').replace(/_/g, '/');
    const jsonText =
      typeof atob === 'function'
        ? atob(base64)
        : typeof Buffer !== 'undefined'
          ? Buffer.from(base64, 'base64').toString('utf8')
          : '';
    if (!jsonText) return null;
    const payloadJson = JSON.parse(jsonText);
    const iss = typeof payloadJson?.iss === 'string' ? payloadJson.iss : '';
    const match = iss.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\b/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function getSupabaseAccessToken(opts?: { refresh?: boolean }): Promise<string | null> {
  try {
    const { data: first, error: firstError } = await supabase.auth.getSession();
    if (firstError) return null;

    const firstSession = first.session;
    if (!firstSession?.access_token) return null;

    const expiresAtMs = typeof firstSession.expires_at === 'number' ? firstSession.expires_at * 1000 : null;
    const shouldRefresh = !!opts?.refresh || (typeof expiresAtMs === 'number' && expiresAtMs <= Date.now() + 60_000);

    if (shouldRefresh) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) return null;
      if (!refreshed.session?.access_token) return null;
    }

    const { data: final, error: finalError } = await supabase.auth.getSession();
    if (finalError) return null;
    const token = final.session?.access_token ?? null;
    if (!token) return null;

    const expectedRef = supabaseProjectRefFromUrl(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'));
    const tokenRef = tokenProjectRefFromAccessToken(token);
    if (expectedRef && tokenRef && expectedRef !== tokenRef) return null;

    return token;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attemptIndex: number, baseMs = 600, maxMs = 8000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attemptIndex - 1)));
  const jitter = Math.floor(Math.random() * 200);
  return exp + jitter;
}

export async function invokeEdgeFunction<T = any>(
  functionName: string,
  options?: {
    body?: any;
    headers?: Record<string, string>;
    requireAuth?: boolean;
    timeoutMs?: number;
    method?: 'POST' | 'GET';
    silent?: boolean;
  }
): Promise<{ data: T | null; error: any | null }> {
  const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const method = options?.method ?? 'POST';
  const timeoutMs = options?.timeoutMs ?? 10000;
  const silent = options?.silent ?? true;
  const requireAuth = options?.requireAuth ?? true;

  const attemptOnce = async (accessToken: string | null) => {
    if (requireAuth && !accessToken) {
      return { data: null as T | null, error: { message: 'No active session', status: 401 } };
    }
    if (!accessToken) {
      return { data: null as T | null, error: { message: 'No active session', status: 401 } };
    }

    const headers = new Headers(options?.headers ?? {});
    headers.set('apikey', anonKey);
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${accessToken}`);

    // Use local proxy to avoid CORS issues
    const url = `/api/proxy/${functionName}`;

    let res: Response;
    try {
      res = await safeFetch(url, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(options?.body ?? {}) : undefined,
        timeout: timeoutMs,
        silent,
      });
    } catch (e: any) {
      if (e instanceof OfflineError) {
        return { data: null as T | null, error: { message: 'Offline', status: 0 } };
      }
      return { data: null as T | null, error: { message: e?.message || 'Network error', status: 0 } };
    }

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

    if (res.ok) return { data: payload as T, error: null };

    const message =
      (payload && typeof payload === 'object' ? (payload as any).error : null) ||
      res.statusText ||
      'Request failed';

    return { data: null as T | null, error: { message, status: res.status, details: payload } };
  };

  const accessToken1 = await getSupabaseAccessToken();
  const maxAttempts = 3;
  let refreshedAfter401 = false;

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(computeBackoffMs(i));

    const accessToken =
      i === 1 ? await getSupabaseAccessToken({ refresh: true }) : i === 2 ? await getSupabaseAccessToken({ refresh: true }) : accessToken1;

    const result = await attemptOnce(accessToken);
    const status = result.error?.status;

    if (!result.error) return result;
    if (status === 401 && requireAuth && !refreshedAfter401) {
      refreshedAfter401 = true;
      const refreshed = await attemptOnce(await getSupabaseAccessToken({ refresh: true }));
      if (!refreshed.error) return refreshed;
      return refreshed;
    }
    if (status === 401 || status === 403) return result;
    if (typeof status === 'number' && status > 0 && status < 500) return result;
  }

  const final = await attemptOnce(await getSupabaseAccessToken({ refresh: true }));
  return final;
}

/**
 * Returns a filter string for manual ownership filtering in Supabase queries.
 * Handles authenticated users only.
 */
export async function getEffectiveOwnershipConditions(user: User | null): Promise<string> {
  // Prioritize authenticated user ID. 
  if (user?.id) {
    return `user_id.eq.${user.id}`;
  }

  // Fallback if no user is present
  // We return a filter that matches nothing
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

export async function updateUserActivity(
  user: User | null,
  opts?: { isOnline?: boolean }
): Promise<void> {
  try {
    const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
    const isInstalled = typeof window !== 'undefined' && (window.navigator as any).standalone || isStandalone;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    const isOnline = typeof opts?.isOnline === 'boolean' ? opts.isOnline : (typeof navigator !== 'undefined' ? navigator.onLine : true);
    if (!isOnline) return;

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
      const accessToken = await getSupabaseAccessToken({ refresh: true });
      if (!accessToken) return;

      const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
      const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
      const payload = { 
        user_id: user.id, 
        last_active_at: new Date().toISOString(),
        user_agent: userAgent,
        is_pwa: isStandalone,
        metadata: metadata
      };

      const response = await safeFetch(`${supabaseUrl}/rest/v1/au_user_activity?on_conflict=user_id`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(payload),
        timeout: 8000,
        silent: true,
      });

      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        if (response.status === 406) return;
        console.warn('[client] Activity update error:', { status: response.status, body: raw });
      }
    }
  } catch (e) {
    console.warn('[client] Failed to update activity:', e);
  }
}
