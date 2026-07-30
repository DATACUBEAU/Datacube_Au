import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { safeFetch, OfflineError } from '@/lib/api/safe-fetch';
import { extractApiError, toApiRequestError, unwrapApiSuccess } from '@/lib/api/api-contract';
import { guardRequest } from '@/lib/api/request-guard';
import {
  normalizeUsableSupabaseSession,
  selectUsableSupabaseSession,
  shouldRefreshSupabaseSession,
  SUPABASE_SESSION_REFRESH_WINDOW_MS,
} from '@/lib/auth/browser-session';
import { syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import {
  areAuthActionsDisabled,
  dispatchSessionExpired,
  getAuthRuntimeState,
  markAuthSessionRestored,
  markAuthRestoring,
} from '@/lib/auth/session-expiry-events';
import type { SessionExpiryTriggerIntent } from '@/lib/auth/session-expiry-policy';
import { readPersistedSupabaseSession } from '@/lib/auth/session-storage';

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_BUCKET: process.env.NEXT_PUBLIC_SUPABASE_BUCKET,
} as const;

let refreshBrowserSessionPromise: Promise<Session | null> | null = null;
let resolveBrowserSessionPromise: Promise<BrowserSessionResolution> | null = null;
const BROWSER_SESSION_RESOLVE_TIMEOUT_MS = 12000;
const USER_ACTIVITY_HEARTBEAT_MS = 5 * 60 * 1000;
const USER_ACTIVITY_METADATA_SYNC_MS = 15 * 60 * 1000;
const userActivityHeartbeatAt = new Map<string, number>();
const userActivityMetadataSyncAt = new Map<string, number>();

type PublicEnvKey = keyof typeof publicEnv;

function requiredEnv(key: PublicEnvKey): string {
  const value = publicEnv[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function isClientAuthDebugEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DCAU_AUTH_DEBUG === '1';
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
    } catch {
      if (isClientAuthDebugEnabled()) {
        console.warn('[customFetch] Error merging request headers.');
      }
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
        if (isClientAuthDebugEnabled()) {
          console.warn('[customFetch] Supabase network retry scheduled.', {
            isAuthRequest: isSupabaseAuthRequest,
            delay,
          });
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt += 1;
        continue;
      }

      if (isClientAuthDebugEnabled()) {
        console.error('[customFetch] Supabase network request failed.', {
          name: err?.name,
          message: err?.message,
          isAuthRequest: isSupabaseAuthRequest,
        });
      }
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
      flowType: 'pkce',
    },
  });
}

export const supabase = createBrowserSupabaseClient();

export type BrowserSessionResolution = {
  session: Session | null;
  source: 'live' | 'persisted' | 'refreshed' | 'none';
  usedCachedSession: boolean;
  refreshed: boolean;
  hasLiveSession: boolean;
  hasPersistedSession: boolean;
};

function readPersistedBrowserSession(): Session | null {
  return readPersistedSupabaseSession();
}

async function readLiveBrowserSession(): Promise<Session | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    return error ? null : data.session ?? null;
  } catch {
    return null;
  }
}

function resolveSessionSource(input: {
  session: Session | null;
  liveSession: Session | null;
  persistedSession: Session | null;
  refreshedSession: Session | null;
}): BrowserSessionResolution['source'] {
  if (!input.session) return 'none';
  if (input.refreshedSession?.access_token && input.session.access_token === input.refreshedSession.access_token) {
    return 'refreshed';
  }
  if (input.liveSession?.access_token && input.session.access_token === input.liveSession.access_token) {
    return 'live';
  }
  if (input.persistedSession?.access_token && input.session.access_token === input.persistedSession.access_token) {
    return 'persisted';
  }
  return 'none';
}

async function readCurrentUsableBrowserSession(): Promise<Session | null> {
  const persistedSession = normalizeUsableSupabaseSession(readPersistedBrowserSession());

  try {
    const liveSession = normalizeUsableSupabaseSession(await readLiveBrowserSession());
    const session = selectUsableSupabaseSession(liveSession, persistedSession);
    if (session) {
      syncServerAuthSessionCookie(session);
    }
    return session;
  } catch {
    if (persistedSession) {
      syncServerAuthSessionCookie(persistedSession);
    }
    return persistedSession;
  }
}

export async function refreshBrowserSession(): Promise<Session | null> {
  const persistedSession = normalizeUsableSupabaseSession(readPersistedBrowserSession());
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
      if (error) {
        if (isClientAuthDebugEnabled()) {
          console.warn('[client] refreshBrowserSession failed.', { hasError: true });
        }
        return readCurrentUsableBrowserSession();
      }
      const refreshedSession = normalizeUsableSupabaseSession(data.session ?? null);
      if (refreshedSession) {
        syncServerAuthSessionCookie(refreshedSession);
        return refreshedSession;
      }
      return readCurrentUsableBrowserSession();
    } catch {
      if (isClientAuthDebugEnabled()) {
        console.error('[client] refreshBrowserSession unexpected error.');
      }
      return readCurrentUsableBrowserSession();
    } finally {
      refreshBrowserSessionPromise = null;
    }
  })();

  return refreshBrowserSessionPromise;
}

async function resolveBrowserSessionInternal(options?: {
  forceRefresh?: boolean;
  refreshWindowMs?: number;
}): Promise<BrowserSessionResolution> {
  const persistedSession = normalizeUsableSupabaseSession(readPersistedBrowserSession());

  if (!isBrowserOnline()) {
    if (persistedSession) {
      syncServerAuthSessionCookie(persistedSession);
    }
    return {
      session: persistedSession,
      source: persistedSession ? 'persisted' : 'none',
      usedCachedSession: Boolean(persistedSession?.user),
      refreshed: false,
      hasLiveSession: false,
      hasPersistedSession: Boolean(persistedSession?.user),
    };
  }

  const liveRawSession = await readLiveBrowserSession();
  const liveSession = normalizeUsableSupabaseSession(liveRawSession);
  const refreshWindowMs = options?.refreshWindowMs ?? SUPABASE_SESSION_REFRESH_WINDOW_MS;
  const refreshCandidate = liveRawSession ?? readPersistedBrowserSession();
  const shouldAttemptRefresh =
    options?.forceRefresh === true ||
    shouldRefreshSupabaseSession(refreshCandidate, Date.now(), refreshWindowMs) ||
    (!liveSession && !persistedSession && Boolean(refreshCandidate?.refresh_token));

  const refreshedSession = shouldAttemptRefresh ? await refreshBrowserSession() : null;
  const session = selectUsableSupabaseSession(refreshedSession, liveSession, persistedSession);
  if (session) {
    syncServerAuthSessionCookie(session);
  }

  const source = resolveSessionSource({
    session,
    liveSession,
    persistedSession,
    refreshedSession,
  });

  return {
    session,
    source,
    usedCachedSession: source === 'persisted' && !liveSession,
    refreshed: source === 'refreshed',
    hasLiveSession: Boolean(liveSession?.user),
    hasPersistedSession: Boolean(persistedSession?.user),
  };
}

function timeoutBrowserSessionResolution(persistedSession: Session | null): Promise<BrowserSessionResolution> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (persistedSession) {
        syncServerAuthSessionCookie(persistedSession);
      }
      resolve({
        session: persistedSession,
        source: persistedSession ? 'persisted' : 'none',
        usedCachedSession: Boolean(persistedSession?.user),
        refreshed: false,
        hasLiveSession: false,
        hasPersistedSession: Boolean(persistedSession?.user),
      });
    }, BROWSER_SESSION_RESOLVE_TIMEOUT_MS);
  });
}

export async function resolveBrowserSession(options?: {
  forceRefresh?: boolean;
  refreshWindowMs?: number;
}): Promise<BrowserSessionResolution> {
  if (resolveBrowserSessionPromise) return resolveBrowserSessionPromise;

  const persistedSession = normalizeUsableSupabaseSession(readPersistedBrowserSession());
  resolveBrowserSessionPromise = Promise.race([
    resolveBrowserSessionInternal(options),
    timeoutBrowserSessionResolution(persistedSession),
  ]).finally(() => {
    resolveBrowserSessionPromise = null;
  });

  return resolveBrowserSessionPromise;
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

type EdgeAuthFailureDiagnostics = {
  authStage: 'proxy_gate' | 'edge_function' | 'unknown';
  reason: string | null;
  hasAuthorizationHeader: boolean | null;
  hasAuthCookie: boolean | null;
  attemptedSources: string[];
  failedSources: string[];
  validatedSource: string | null;
  requestId: string | null;
};

function parseDelimitedHeader(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseDebugBoolean(raw: string | null): boolean | null {
  if (raw == null || raw === '') return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return null;
}

function parseEdgeAuthFailureDiagnostics(response: Response, payload: unknown): EdgeAuthFailureDiagnostics {
  const parsed = extractApiError(payload, response.statusText || 'Request failed');
  const details = parsed.details && typeof parsed.details === 'object' ? parsed.details as Record<string, any> : null;
  const requestAuth =
    details?.request_auth && typeof details.request_auth === 'object'
      ? details.request_auth as Record<string, any>
      : null;
  const requestId =
    typeof (payload as any)?.requestId === 'string'
      ? String((payload as any).requestId)
      : typeof (payload as any)?.request_id === 'string'
        ? String((payload as any).request_id)
        : response.headers.get('x-request-id');

  return {
    authStage: (
      response.headers.get('x-dcau-auth-stage') ||
      details?.auth_stage ||
      'unknown'
    ) as EdgeAuthFailureDiagnostics['authStage'],
    reason:
      response.headers.get('x-dcau-auth-reason') ||
      (typeof details?.reason === 'string' ? details.reason : null) ||
      null,
    hasAuthorizationHeader:
      parseDebugBoolean(response.headers.get('x-dcau-auth-has-authorization')) ??
      (typeof requestAuth?.has_authorization === 'boolean' ? requestAuth.has_authorization : null),
    hasAuthCookie:
      parseDebugBoolean(response.headers.get('x-dcau-auth-has-cookie')) ??
      (typeof requestAuth?.has_cookie === 'boolean' ? requestAuth.has_cookie : null),
    attemptedSources:
      parseDelimitedHeader(response.headers.get('x-dcau-auth-attempted-sources')).length > 0
        ? parseDelimitedHeader(response.headers.get('x-dcau-auth-attempted-sources'))
        : Array.isArray(requestAuth?.attempted_sources)
          ? requestAuth.attempted_sources.map((entry: unknown) => String(entry))
          : [],
    failedSources:
      parseDelimitedHeader(response.headers.get('x-dcau-auth-failed-sources')).length > 0
        ? parseDelimitedHeader(response.headers.get('x-dcau-auth-failed-sources'))
        : Array.isArray(requestAuth?.failed_sources)
          ? requestAuth.failed_sources.map((entry: unknown) => String(entry))
          : [],
    validatedSource:
      response.headers.get('x-dcau-auth-source') ||
      (typeof requestAuth?.validated_source === 'string' ? requestAuth.validated_source : null),
    requestId: requestId || null,
  };
}

async function readEdgeAuthFailureDiagnostics(response: Response): Promise<EdgeAuthFailureDiagnostics> {
  const raw = await response.clone().text().catch(() => '');
  if (!raw) {
    return parseEdgeAuthFailureDiagnostics(response, null);
  }

  try {
    return parseEdgeAuthFailureDiagnostics(response, JSON.parse(raw));
  } catch {
    return parseEdgeAuthFailureDiagnostics(response, { message: raw, details: raw });
  }
}

async function validateBrowserAccessToken(accessToken: string | null): Promise<boolean | null> {
  if (!accessToken) return false;
  if (!isBrowserOnline()) return null;

  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) return false;
    return Boolean(data.user?.id);
  } catch {
    if (isClientAuthDebugEnabled()) {
      console.warn('[client] access token validation was inconclusive.');
    }
    return null;
  }
}

function shouldRetryWithRecoveredToken(input: {
  diagnostics: EdgeAuthFailureDiagnostics;
  attemptedToken: string | null;
  candidateToken: string | null;
}): boolean {
  if (!input.candidateToken) return false;
  if (input.candidateToken !== input.attemptedToken) return true;
  if (input.diagnostics.reason === 'missing_token') return true;
  if (input.diagnostics.hasAuthorizationHeader === false) return true;
  if (input.diagnostics.hasAuthCookie === false) return true;
  return false;
}

function shouldSuppressSessionExpiryAfterEdge401(input: {
  currentState: ReturnType<typeof getAuthRuntimeState>;
  diagnostics: EdgeAuthFailureDiagnostics;
  refreshedResolution: BrowserSessionResolution;
  settledResolution: BrowserSessionResolution;
  latestSession: Session | null;
  latestTokenValidation: boolean | null;
}): boolean {
  const hasRecoverableSession =
    Boolean(input.latestSession?.access_token) && input.latestTokenValidation !== false;
  const hasResolvableBrowserSession =
    input.refreshedResolution.source !== 'none' ||
    input.settledResolution.source !== 'none' ||
    Boolean(input.latestSession?.refresh_token);

  return (
    input.currentState !== 'AUTHENTICATED' ||
    input.diagnostics.authStage === 'edge_function' ||
    hasRecoverableSession ||
    input.latestTokenValidation == null ||
    hasResolvableBrowserSession
  );
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  try {
    const resolved = await resolveBrowserSession({
      refreshWindowMs: SUPABASE_SESSION_REFRESH_WINDOW_MS,
    });
    const session = resolved.session;
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

/**
 * @deprecated All callers have been migrated to VPS ticket + direct fetch.
 * This function routes to /api/proxy/{functionName} which no longer exists.
 * Retained temporarily for type-export compatibility. DO NOT add new callers.
 */
export async function fetchEdgeFunctionResponse(
  functionName: string,
  options?: EdgeFunctionRequestOptions,
): Promise<Response> {
  if (isClientAuthDebugEnabled()) {
    console.warn('[DEPRECATED] fetchEdgeFunctionResponse called; migrate caller to VPS ticket architecture.', {
      functionName,
    });
  }
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const method = options?.method ?? 'POST';
  const timeoutMs = options?.timeoutMs ?? 10000;
  const silent = options?.silent ?? true;
  const requireAuth = options?.requireAuth ?? true;
  const allowOffline = options?.allowOffline === true;
  const authIntent = options?.authIntent ?? 'interactive';
  const reauthOnAuthFailure = options?.reauthOnAuthFailure ?? (authIntent === 'interactive');
  const requestBody = resolveEdgeRequestBody(method, options?.body);
  const restoreRecoveredAuthState = () => {
    if (getAuthRuntimeState() === 'RESTORING') {
      markAuthSessionRestored(`invokeEdgeFunction:${functionName}`);
    }
  };

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
      accessToken,
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
      retries: 0,
      signal: options?.signal,
    });
  };

  const initialResolution = requireAuth
    ? await resolveBrowserSession({
        refreshWindowMs: SUPABASE_SESSION_REFRESH_WINDOW_MS,
      })
    : { session: null };
  const initialToken = initialResolution.session?.access_token ?? null;
  let lastAttemptedToken = initialToken;
  let response = await attemptOnce(lastAttemptedToken);

  if (!requireAuth || response.status !== 401) {
    return response;
  }

  let authDiagnostics = await readEdgeAuthFailureDiagnostics(response);
  if (isClientAuthDebugEnabled()) {
    console.warn('[client] protected edge request returned 401', {
      functionName,
      authStage: authDiagnostics.authStage,
      reason: authDiagnostics.reason,
      hasAuthorizationHeader: authDiagnostics.hasAuthorizationHeader,
      hasAuthCookie: authDiagnostics.hasAuthCookie,
      attemptedSources: authDiagnostics.attemptedSources,
      failedSources: authDiagnostics.failedSources,
      validatedSource: authDiagnostics.validatedSource,
      requestId: authDiagnostics.requestId,
    });
  }

  const currentState = getAuthRuntimeState();
  const enteredRecoveryState = reauthOnAuthFailure && isBrowserOnline() && currentState === 'AUTHENTICATED';
  if (enteredRecoveryState) {
    markAuthRestoring(`invokeEdgeFunction:${functionName}`);
  }

  const refreshedResolution = await resolveBrowserSession({
    forceRefresh: true,
    refreshWindowMs: SUPABASE_SESSION_REFRESH_WINDOW_MS,
  });
  const refreshedToken = refreshedResolution.session?.access_token ?? null;

  if (shouldRetryWithRecoveredToken({
    diagnostics: authDiagnostics,
    attemptedToken: lastAttemptedToken,
    candidateToken: refreshedToken,
  })) {
    lastAttemptedToken = refreshedToken;
    response = await attemptOnce(refreshedToken);
    if (response.status !== 401) {
      restoreRecoveredAuthState();
      return response;
    }
    authDiagnostics = await readEdgeAuthFailureDiagnostics(response);
  }

  const settledResolution = await resolveBrowserSession({
    refreshWindowMs: SUPABASE_SESSION_REFRESH_WINDOW_MS,
  });
  const settledSession = settledResolution.session;
  const settledToken = settledSession?.access_token ?? null;
  if (response.status === 401 && shouldRetryWithRecoveredToken({
    diagnostics: authDiagnostics,
    attemptedToken: lastAttemptedToken,
    candidateToken: settledToken,
  })) {
    lastAttemptedToken = settledToken;
    response = await attemptOnce(settledToken);
    if (response.status !== 401) {
      restoreRecoveredAuthState();
      return response;
    }
    authDiagnostics = await readEdgeAuthFailureDiagnostics(response);
  }

  if (reauthOnAuthFailure && requireAuth && response.status === 401) {
    const latestSession = await readCurrentUsableBrowserSession();
    const latestToken = latestSession?.access_token ?? null;
    const latestTokenValidation = await validateBrowserAccessToken(latestToken);
    const shouldSuppressExpiry = shouldSuppressSessionExpiryAfterEdge401({
      currentState,
      diagnostics: authDiagnostics,
      refreshedResolution,
      settledResolution,
      latestSession,
      latestTokenValidation,
    });

    if (!shouldSuppressExpiry) {
      dispatchSessionExpired({
        status: 401,
        source: `invokeEdgeFunction:${functionName}`,
        reason: authDiagnostics.reason || (refreshedToken ? 'edge_retry_auth_error' : 'refresh_failed_no_token'),
        intent: authIntent,
      });
    } else {
      if (enteredRecoveryState) {
        restoreRecoveredAuthState();
      }
      if (isClientAuthDebugEnabled()) {
        console.warn('[client] suppressed session expiry for recoverable or endpoint-scoped 401', {
          functionName,
          currentState,
          status: response.status,
          authStage: authDiagnostics.authStage,
          reason: authDiagnostics.reason,
          hasAuthorizationHeader: authDiagnostics.hasAuthorizationHeader,
          hasAuthCookie: authDiagnostics.hasAuthCookie,
          validatedSource: authDiagnostics.validatedSource,
          latestTokenValidated: latestTokenValidation,
          refreshedSessionSource: refreshedResolution.source,
          settledSessionSource: settledResolution.source,
          hasLatestRefreshToken: Boolean(latestSession?.refresh_token),
          requestId: authDiagnostics.requestId,
        });
      }
    }
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
    const response = await safeFetch('/api/auth/activity', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: String(event || 'activity'),
        metadata,
      }),
      timeout: timeoutMs,
      silent: true,
      retries: 0,
    });

    if (response.ok) {
      return true;
    }

    if (response.status === 401 || response.status === 403) {
      return false;
    }

    if (isClientAuthDebugEnabled()) {
      console.warn('[client] record_user_activity failed.', { status: response.status });
    }
  } catch (error) {
    if (!(error instanceof OfflineError) && isClientAuthDebugEnabled()) {
      console.warn('[client] record_user_activity failed.');
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
  opts?: { isOnline?: boolean; force?: boolean }
): Promise<void> {
  try {
    const userId = String(user?.id || '').trim();
    if (!userId) return;
    const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
    const isInstalled = typeof window !== 'undefined' && (window.navigator as any).standalone || isStandalone;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    const isOnline = typeof opts?.isOnline === 'boolean' ? opts.isOnline : (typeof navigator !== 'undefined' ? navigator.onLine : true);
    if (!isOnline) return;
    const now = Date.now();
    const lastHeartbeatAt = userActivityHeartbeatAt.get(userId) ?? 0;
    const shouldSkipHeartbeat = !opts?.force && now - lastHeartbeatAt < USER_ACTIVITY_HEARTBEAT_MS;
    if (shouldSkipHeartbeat) {
      return;
    }
    userActivityHeartbeatAt.set(userId, now);

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
        displayMode: isStandalone ? 'standalone' : 'browser',
      },
      device: {
        browserName: deviceInfo?.browserName || 'unknown',
        platform: deviceInfo?.platform || (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
        osName: deviceInfo?.osName || 'unknown',
        deviceType: deviceInfo?.deviceType || 'unknown',
        isMobile: deviceInfo?.deviceType ? (deviceInfo.deviceType === 'mobile' || deviceInfo.deviceType === 'tablet') : /iPhone|iPad|iPod|Android/i.test(userAgent),
        language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
      },
      connection: {
        isOnline,
        checked_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };

    const accessToken = await getSupabaseAccessToken();
    if (!accessToken) return;

    const lastMetadataSyncAt = userActivityMetadataSyncAt.get(userId) ?? 0;
    const shouldSyncMetadata =
      opts?.force ||
      now - lastMetadataSyncAt >= USER_ACTIVITY_METADATA_SYNC_MS;
    const recorded = await recordUserActivityRpc({
      userId,
      event: 'activity',
      metadata: shouldSyncMetadata
        ? metadata
        : {
            connection: metadata.connection,
            pwa: metadata.pwa,
          },
      accessToken,
      timeoutMs: 6000,
    });

    if (!recorded) {
      return;
    }

    if (shouldSyncMetadata) {
      userActivityMetadataSyncAt.set(userId, now);
    }
  } catch {
    if (isClientAuthDebugEnabled()) {
      console.warn('[client] Failed to update activity.');
    }
  }
}
