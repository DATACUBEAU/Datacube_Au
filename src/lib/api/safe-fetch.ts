import { toast } from '@/hooks/use-toast';
import { dispatchSessionExpired } from '@/lib/auth/session-expiry-events';

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
  const { timeout = 10000, signal, allowOffline = false, ...fetchOptions } = options;

  if (!allowOffline && isOfflineNow()) {
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

  const MAX_RETRIES = 2; // Retry twice on network errors
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    const controller = new AbortController();
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
      if (signal) signal.removeEventListener('abort', onAbort);

      // Client-only: emit monetization/limit events (handled by dashboard listeners).
      if (typeof window !== 'undefined' && (response.status === 402 || response.status === 429)) {
        try {
          const clone = response.clone();
          const body = await clone.json();
          const context = body?.error?.code === 'UPGRADE_REQUIRED' ? body.error : body;
          if (context?.code === 'UPGRADE_REQUIRED') {
            window.dispatchEvent(new CustomEvent('au-upgrade-required', { detail: context }));
          }
          const limitContext = body?.code === 'LIMIT_EXCEEDED'
            ? body
            : (body?.details?.code === 'LIMIT_EXCEEDED' ? body.details : null);
          if (limitContext?.code === 'LIMIT_EXCEEDED') {
            window.dispatchEvent(new CustomEvent('au_limit_reached', {
              detail: {
                ...limitContext,
                message: `Limit exceeded (${String(limitContext.limit || 'unknown')}).`,
              },
            }));
          }
        } catch {
        }
      }

      if (typeof window !== 'undefined' && (response.status === 401 || response.status === 403)) {
        dispatchSessionExpired({
          status: response.status,
          source: 'safeFetch',
          reason: 'http_auth_error',
        });
      }
      
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
      
      const isAbort = error?.name === 'AbortError';
      const isUserAbort = isAbort && !!signal?.aborted;
      const isTimeoutAbort = isAbort && !signal?.aborted;
      const isNetworkError = !isAbort; // Fetch only throws on network error (DNS, etc)

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
      if ((isNetworkError || isTimeoutAbort) && attempt < MAX_RETRIES) {
        attempt++;
        const delay = 1000 * attempt; // 1s, 2s
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
        throw new Error("Request timed out");
      }
      throw error;
    }
  }
  
  throw new Error("Unreachable code in safeFetch");
}
