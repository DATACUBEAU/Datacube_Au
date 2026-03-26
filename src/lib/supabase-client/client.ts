import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { safeFetch, OfflineError } from '@/lib/api/safe-fetch';
import { toApiRequestError, unwrapApiSuccess } from '@/lib/api/api-contract';
import { guardRequest } from '@/lib/api/request-guard';
import { normalizeUsableSupabaseSession, selectUsableSupabaseSession } from '@/lib/auth/browser-session';
import { syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import { areAuthActionsDisabled, dispatchSessionExpired } from '@/lib/auth/session-expiry-events';
import type { SessionExpiryTriggerIntent } from '@/lib/auth/session-expiry-policy';
import { readPersistedSupabaseSession } from '@/lib/auth/session-storage';

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_BUCKET: process.env.NEXT_PUBLIC_SUPABASE_BUCKET,
} as const;

let refreshBrowserSessionPromise: Promise<Session | null> | null = null;

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

function isBrowserOnline(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof (window as any).__DCAU_NETWORK_STATE?.isOnline === 'boolean') {
    return (window as any).__DCAU_NETWORK_STATE.isOnline !== false;
  }
  return window.navigator.onLine !== false;
}

const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL || '';
  const isSupabaseRequest = supabaseUrl && url.includes(supabaseUrl);
  const isSupabaseAuthRequest = /\/auth\/v1\//i.test(url);
  
  if (!isSupabaseRequest) {
    return fetch(input, init);
  }

  if (areAuthActionsDisabled() && !isSupabaseAuthRequest) {
    const authError: any = new Error('Session expired. Re-authentication required.');
    authError.name = 'AuthRequiredError';
    authError.status = 401;
    authError.code = 'AUTH_REQUIRED';
    throw authError;
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

  // Retry logic for network failures only.
  const MAX_RETRIES = 2;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      return await fetch(fetchInput, newInit);
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      if (isAbort) {
        throw err;
      }

      if (attempt < MAX_RETRIES) {
        const delay = 500 * Math.pow(2, attempt);
        console.warn(`[customFetch] Network error fetching ${url}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt += 1;
        continue;
      }

      console.error(`[customFetch] Network error fetching ${url}:`, {
        name: err?.name,
        message: err?.message,
        url: url
      });
      throw err;
    }
  }

  throw new Error('Unreachable code in customFetch');
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

async function refreshBrowserSession(): Promise<Session | null> {
  const persistedSession = normalizeUsableSupabaseSession(readPersistedSupabaseSession());
  if (!isBrowserOnline()) {
    if (persistedSession) {
      syncServerAuthSessionCookie(persistedSession);
    }
    return persistedSession;
  }
  if (refreshBrowserSessionPromise) return refreshBrowserSessionPromise;

  refreshBrowserSessionPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      const refreshedSession = normalizeUsableSupabaseSession(error ? null : data.session ?? null);
      const nextSession = selectUsableSupabaseSession(refreshedSession, persistedSession);
      if (nextSession) {
        syncServerAuthSessionCookie(nextSession);
      }
      return nextSession;
    } catch {
      if (persistedSession) {
        syncServerAuthSessionCookie(persistedSession);
      }
      return persistedSession;
    } finally {
      refreshBrowserSessionPromise = null;
    }
  })();

  return refreshBrowserSessionPromise;
}

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

export async function getSupabaseAccessToken(): Promise<string | null> {
  try {
    const persistedSession = normalizeUsableSupabaseSession(readPersistedSupabaseSession());
    const { data, error } = await supabase.auth.getSession();
    let session = normalizeUsableSupabaseSession(error ? null : data.session ?? null);

    const expiresAt = session?.expires_at;
    const isExpiredOrExpiring =
      typeof expiresAt === 'number' && expiresAt * 1000 <= Date.now() + 5000;

    if (!session && persistedSession) {
      session = persistedSession;
    }

    if ((!session || isExpiredOrExpiring) && isBrowserOnline()) {
      session = selectUsableSupabaseSession(await refreshBrowserSession(), persistedSession);
    }

    const token = session?.access_token ?? null;
    if (!token) return null;

    // Security check: ensure token matches project
    const expectedRef = supabaseProjectRefFromUrl(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'));
    const tokenRef = tokenProjectRefFromAccessToken(token);
    if (expectedRef && tokenRef && expectedRef !== tokenRef) return null;

    syncServerAuthSessionCookie(session);
    return token;
  } catch {
    return null;
  }
}

type EdgeFunctionRequestOptions = {
  body?: any;
  headers?: Record<string, string>;
  requireAuth?: boolean;
  timeoutMs?: number;
  method?: 'POST' | 'GET';
  silent?: boolean;
  allowOffline?: boolean;
  authIntent?: SessionExpiryTriggerIntent;
  reauthOnAuthFailure?: boolean;
  signal?: AbortSignal;
};

function isBodyInitLike(value: unknown): value is BodyInit {
  if (typeof value === 'string') return true;
  if (value instanceof Blob) return true;
  if (value instanceof FormData) return true;
  if (value instanceof URLSearchParams) return true;
  if (value instanceof ReadableStream) return true;
  if (value instanceof ArrayBuffer) return true;
  return ArrayBuffer.isView(value);
}

function resolveEdgeRequestBody(method: 'POST' | 'GET', body: unknown): BodyInit | undefined {
  if (method !== 'POST' || body == null) return undefined;
  if (isBodyInitLike(body)) return body;
  return JSON.stringify(body ?? {});
}

export async function fetchEdgeFunctionResponse(
  functionName: string,
  options?: EdgeFunctionRequestOptions,
): Promise<Response> {
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const method = options?.method ?? 'POST';
  const timeoutMs = options?.timeoutMs ?? 10000;
  const silent = options?.silent ?? true;
  const requireAuth = options?.requireAuth ?? true;
  const allowOffline = options?.allowOffline === true;
  const authIntent = options?.authIntent ?? 'interactive';
  const reauthOnAuthFailure = options?.reauthOnAuthFailure ?? (authIntent === 'interactive');
  const requestBody = resolveEdgeRequestBody(method, options?.body);

  const attemptOnce = async (accessToken: string | null) => {
    const isOnline =
      typeof window === 'undefined'
        ? true
        : (typeof (window as any).__DCAU_NETWORK_STATE?.isOnline === 'boolean'
            ? (window as any).__DCAU_NETWORK_STATE.isOnline
            : window.navigator.onLine);
    const gate = guardRequest({
      isOnline,
      requireAuth,
      accessToken: accessToken ?? (requireAuth ? '__cookie_session__' : null),
      allowOfflineRead: allowOffline,
      warnKey: `invoke-edge:${functionName}`,
      context: functionName,
    });

    if (!gate.ok) {
      if (gate.reason === 'unauthenticated' && requireAuth && reauthOnAuthFailure) {
        dispatchSessionExpired({
          status: 401,
          source: `invokeEdgeFunction:${functionName}`,
          reason: 'request_guard_unauthenticated',
          intent: authIntent,
        });
      }

      throw toApiRequestError({
        message: gate.message,
        status: gate.reason === 'offline' ? 0 : 401,
        code: gate.reason === 'offline' ? 'OFFLINE' : 'UNAUTHORIZED',
        retryable: gate.reason === 'offline',
      });
    }

    const headers = new Headers(options?.headers ?? {});
    headers.set('apikey', anonKey);
    if (requestBody && !(requestBody instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    return safeFetch(`/api/proxy/${functionName}`, {
      method,
      headers,
      body: requestBody,
      credentials: 'include',
      timeout: timeoutMs,
      silent,
      allowOffline,
      suppressAuthError: true,
      authIntent,
      signal: options?.signal,
    });
  };

  let accessToken = await getSupabaseAccessToken();
  let response = await attemptOnce(accessToken);

  if (!requireAuth || response.status !== 401) {
    return response;
  }

  try {
    accessToken = (await refreshBrowserSession())?.access_token ?? accessToken;
  } catch {
    // Fall back to the original unauthorized response.
  }

  if (!accessToken) {
    if (reauthOnAuthFailure) {
      dispatchSessionExpired({
        status: 401,
        source: `invokeEdgeFunction:${functionName}`,
        reason: 'refresh_failed_no_token',
        intent: authIntent,
      });
    }
    return response;
  }

  response = await attemptOnce(accessToken);
  if (reauthOnAuthFailure && requireAuth && response.status === 401) {
    dispatchSessionExpired({
      status: 401,
      source: `invokeEdgeFunction:${functionName}`,
      reason: 'edge_retry_auth_error',
      intent: authIntent,
    });
  }

  return response;
}

type RecordUserActivityRpcOptions = {
  userId: string;
  event?: string;
  metadata?: Record<string, unknown>;
  accessToken?: string | null;
  timeoutMs?: number;
};

export async function recordUserActivityRpc({
  userId,
  event = 'activity',
  metadata = {},
  accessToken,
  timeoutMs = 8000,
}: RecordUserActivityRpcOptions): Promise<boolean> {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;
  if (areAuthActionsDisabled()) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  const token =
    typeof accessToken === 'string' && accessToken.trim().length > 0
      ? accessToken.trim()
      : await getSupabaseAccessToken();
  if (!token) return false;

  try {
    const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const response = await safeFetch(`${supabaseUrl}/rest/v1/rpc/record_user_activity`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: normalizedUserId,
        p_event: String(event || 'activity'),
        p_metadata: metadata,
      }),
      timeout: timeoutMs,
      silent: true,
    });

    if (response.ok) {
      return true;
    }

    if (response.status === 401 || response.status === 403) {
      return false;
    }

    const raw = await response.text().catch(() => '');
    console.warn('[client] record_user_activity failed:', { status: response.status, body: raw });
  } catch (error) {
    if (!(error instanceof OfflineError)) {
      console.warn('[client] record_user_activity failed:', error);
    }
  }

  return false;
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
    allowOffline?: boolean;
    authIntent?: SessionExpiryTriggerIntent;
    reauthOnAuthFailure?: boolean;
    signal?: AbortSignal;
  }
): Promise<{ data: T | null; error: any | null }> {
  try {
    const res = await fetchEdgeFunctionResponse(functionName, options);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

    if (res.ok) {
      return { data: unwrapApiSuccess(payload as T) as T, error: null };
    }

    return {
      data: null as T | null,
      error: toApiRequestError(
        payload && typeof payload === 'object'
          ? { ...(payload as Record<string, unknown>), status: res.status }
          : { message: payload || res.statusText || 'Request failed', status: res.status },
        res.statusText || 'Request failed',
      ),
    };
  } catch (e: any) {
    if (e instanceof OfflineError) {
      return {
        data: null as T | null,
        error: toApiRequestError({ message: 'Offline', status: 0, code: 'OFFLINE', retryable: true }),
      };
    }
    return {
      data: null as T | null,
      error: toApiRequestError(e, e?.message || 'Network error'),
    };
  }
}

/**
 * Returns a filter string for manual ownership filtering in Supabase queries.
 * Handles authenticated users only.
 */
export async function getEffectiveOwnershipConditions(user: User | null): Promise<string> {
  // Prioritize authenticated user ID. 
  if (user?.id) {
    return `owner_id.eq.${user.id},user_id.eq.${user.id}`;
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
      const accessToken = await getSupabaseAccessToken();
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

      await recordUserActivityRpc({
        userId: user.id,
        event: 'activity',
        metadata: {},
        accessToken,
      });
    }
  } catch (e) {
    console.warn('[client] Failed to update activity:', e);
  }
}
