import { toast } from '@/hooks/use-toast';
import {
  dispatchSessionExpired,
  isAuthLocked,
  registerAuthBoundAbortController,
} from '@/lib/auth/session-expiry-events';
import type { SessionExpiryTriggerIntent } from '@/lib/auth/session-expiry-policy';

export class OfflineError extends Error {
  constructor(message = "You are offline") {
    super(message);
    this.name = "OfflineError";
  }
}

interface SafeFetchOptions extends RequestInit {
  timeout?: number;
  silent?: boolean; // If true, suppresses global toast on offline/error
  allowOffline?: boolean; // If true, caller handles offline fallback manually
  allowWhenAuthLocked?: boolean; // If true, bypasses auth-lock guard (used for login/reauth flows)
  suppressAuthError?: boolean; // If true, 401/403 errors will not trigger global session expiry events
  authIntent?: SessionExpiryTriggerIntent; // Distinguishes interactive calls from passive/bootstrap traffic
  retries?: number | false; // Disable blind retries for interactive or non-idempotent traffic by default.
  retryDelayMs?: number;
  offlineQueueable?: boolean; // If true, queue write operations when offline instead of throwing
  offlineQueueLabel?: string; // Human-readable label for the queued operation in the sync UI
  offlineQueueUserId?: string | null; // Authenticated user scope for private queued writes
  offlineQueueRequiresAuth?: boolean; // Defaults to true for queued writes
}

function isSafeFetchDebugEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DCAU_AUTH_DEBUG === '1';
}

function createSafeFetchError(
  message: string,
  extra?: {
    status?: number;
    code?: string;
    retryable?: boolean;
    cause?: unknown;
  },
) {
  const error: any = new Error(message);
  if (typeof extra?.status === 'number') error.status = extra.status;
  if (typeof extra?.code === 'string') error.code = extra.code;
  if (typeof extra?.retryable === 'boolean') error.retryable = extra.retryable;
  if (extra?.cause !== undefined) error.cause = extra.cause;
  return error;
}

/**
 * A wrapper around fetch that handles:
 * 1. Offline detection (throws OfflineError immediately)
 * 2. Timeouts (aborts request after X ms)
 * 3. Consistent error formatting
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const isOfflineNow = () =>
    typeof window !== 'undefined' &&
    (window.navigator.onLine === false ||
      (typeof (window as any).__DCAU_NETWORK_STATE?.isOnline === 'boolean' &&
        (window as any).__DCAU_NETWORK_STATE.isOnline === false));

  // 1. Offline Check
  const {
    timeout = 10000,
    signal,
    allowOffline = false,
    allowWhenAuthLocked = false,
    suppressAuthError = false,
    authIntent = 'background',
    retries,
    retryDelayMs = 750,
    offlineQueueable = false,
    offlineQueueLabel,
    offlineQueueUserId,
    offlineQueueRequiresAuth = true,
    ...fetchOptions
  } = options;
  const method = String(fetchOptions.method || options.method || 'GET').trim().toUpperCase();
  const maxRetries =
    typeof retries === 'number'
      ? Math.max(0, Math.floor(retries))
      : retries === false
        ? 0
        : authIntent === 'interactive'
          ? 0
          : (method === 'GET' || method === 'HEAD' ? 1 : 0);

  if (!allowWhenAuthLocked && isAuthLocked()) {
    throw createSafeFetchError('Session expired. Sign in again.', {
      status: 401,
      code: 'AUTH_REQUIRED',
      retryable: false,
    });
  }

  if (!allowOffline && isOfflineNow()) {
    // If the request is queueable and is a write method, enqueue it
    if (
      offlineQueueable &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ) {
      try {
        const { enqueueWrite } = await import('@/lib/offline/write-queue');
        let queuedUserId = String(offlineQueueUserId || '').trim() || null;
        if (offlineQueueRequiresAuth && !queuedUserId) {
          const { readPersistedSupabaseSession } = await import('@/lib/auth/session-storage');
          queuedUserId = readPersistedSupabaseSession()?.user?.id ?? null;
        }
        const headersObj: Record<string, string> = {};
        if (fetchOptions.headers) {
          const h = new Headers(fetchOptions.headers);
          h.forEach((value, key) => {
            headersObj[key] = value;
          });
        }
        const entry = await enqueueWrite({
          url,
          method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          body: fetchOptions.body ? JSON.parse(String(fetchOptions.body)) : undefined,
          headers: headersObj,
          label: offlineQueueLabel || `${method} ${url.split('/').slice(-2).join('/')}`,
          userId: queuedUserId,
          requiresAuth: offlineQueueRequiresAuth,
        });

        if (entry) {
          if (!options.silent) {
            toast({
              title: 'Saved for sync',
              description: 'Your action will be sent when you\'re back online.',
              duration: 3000,
            });
          }
          // Return a synthetic accepted response
          return new Response(
            JSON.stringify({
              ok: true,
              queued: true,
              queueId: entry.id,
              message: 'Operation queued for offline sync.',
            }),
            {
              status: 202,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-dcau-queued': 'true',
                'x-dcau-queue-id': entry.id,
              },
            },
          );
        }
      } catch {
        if (isSafeFetchDebugEnabled()) {
          console.warn('[safeFetch] Failed to enqueue offline write.');
        }
      }
    }

    if (!options.silent) {
        toast({
            variant: 'destructive',
            title: "No Connection",
            description: "Request blocked because you are offline.",
            duration: 3000
        });
    }
    throw new OfflineError();
  }

  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const unregisterAbort = registerAuthBoundAbortController(controller);
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();

    // Link user signal if provided
    if (signal) {
        signal.addEventListener('abort', onAbort);
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      unregisterAbort();
      if (signal) signal.removeEventListener('abort', onAbort);

      // Client-only: emit monetization/limit events (handled by dashboard listeners).
      if (typeof window !== 'undefined' && (response.status === 402 || response.status === 429)) {
        try {
          const clone = response.clone();
          const body = await clone.json();
          const rootErrorCode = typeof body?.error === 'string' ? body.error : '';
          const nestedErrorCode = typeof body?.error?.code === 'string' ? body.error.code : '';
          const bodyCode = typeof body?.code === 'string' ? body.code : '';
          const code = rootErrorCode || nestedErrorCode || bodyCode;

          const upgradeContext = {
            code: code || (body?.error?.code || null),
            key: body?.key || body?.limit || body?.error?.key || body?.error?.limit,
            reason: body?.message || body?.error?.message || body?.error?.reason || body?.details?.reason,
            message: body?.message || body?.error?.message || body?.details?.message,
            cta: body?.upgrade?.cta || body?.error?.cta || 'Upgrade to Pro',
            upgradeUrl: body?.upgrade?.href || body?.error?.upgradeUrl || '/pricing',
            used: body?.used ?? body?.current ?? body?.error?.used ?? body?.error?.current,
            limit: body?.limit ?? body?.max ?? body?.error?.limit ?? body?.error?.max,
            resetsAt: body?.reset_at ?? body?.resetAt ?? body?.error?.reset_at ?? body?.error?.resetsAt ?? null,
          };

          if (['UPGRADE_REQUIRED', 'PRO_REQUIRED'].includes(String(upgradeContext.code || ''))) {
            window.dispatchEvent(new CustomEvent('au-upgrade-required', { detail: upgradeContext }));
          }

          const limitCode =
            code === 'LIMIT_REACHED' || code === 'LIMIT_EXCEEDED'
              ? code
              : (typeof body?.details?.code === 'string' ? body.details.code : '');
          if (['LIMIT_REACHED', 'LIMIT_EXCEEDED'].includes(String(limitCode || ''))) {
            window.dispatchEvent(new CustomEvent('au_limit_reached', {
              detail: {
                ...(body || {}),
                code: limitCode,
                limit: body?.limit || body?.key || body?.details?.limit || body?.details?.key,
                message: body?.message || `Limit exceeded (${String(body?.limit || body?.key || 'unknown')}).`,
              },
            }));
            window.dispatchEvent(new CustomEvent('au-upgrade-required', { detail: upgradeContext }));
          }
        } catch {
        }
      }

      if (
        typeof window !== 'undefined' &&
        response.status === 401 &&
        !suppressAuthError &&
        authIntent === 'interactive'
      ) {
        if (isSafeFetchDebugEnabled()) {
          console.warn('[safeFetch] auth error detected', {
            status: response.status,
            sameOrigin: url.startsWith('/'),
            requestId: response.headers.get('x-request-id'),
            correlationId: response.headers.get('x-correlation-id'),
          });
        }

        dispatchSessionExpired({
          status: response.status,
          source: 'safeFetch',
          reason: 'http_auth_error',
          intent: authIntent,
        });
      }
      
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      unregisterAbort();
      if (signal) signal.removeEventListener('abort', onAbort);
      
      const isAbort = error?.name === 'AbortError';
      const isUserAbort = isAbort && !!signal?.aborted;
      const isAuthAbort = isAbort && !signal?.aborted && controller.signal.aborted && isAuthLocked();
      const isTimeoutAbort = isAbort && !signal?.aborted && !isAuthAbort;
      const isNetworkError = !isAbort; // Fetch only throws on network error (DNS, etc)

      if (isAuthAbort) {
        throw createSafeFetchError('Session expired. Sign in again.', {
          status: 401,
          code: 'AUTH_REQUIRED',
          retryable: false,
        });
      }

      // User-requested abort should never retry.
      if (isUserAbort) {
        const abortError = new Error('Request aborted');
        (abortError as any).name = 'AbortError';
        throw abortError;
      }

      if (isOfflineNow()) {
        throw new OfflineError();
      }

      // If it's a network error or timeout, and we have retries left, retry.
      if ((isNetworkError || isTimeoutAbort) && attempt < maxRetries) {
        attempt++;
        const delay = Math.max(250, retryDelayMs) * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (isTimeoutAbort) {
        if (!options.silent) {
            toast({
                variant: 'destructive',
                title: "Request Timed Out",
                description: "The server took too long to respond.",
                duration: 3000
            });
        }
        throw createSafeFetchError('Request timed out', {
          status: 408,
          code: 'REQUEST_TIMEOUT',
          retryable: true,
        });
      }
      if (isNetworkError) {
        throw createSafeFetchError(
          String(error?.message || 'Network request failed'),
          {
            status: 0,
            code: 'NETWORK_ERROR',
            retryable: true,
            cause: error,
          },
        );
      }
      throw error;
    }
  }
  
  throw new Error("Unreachable code in safeFetch");
}
