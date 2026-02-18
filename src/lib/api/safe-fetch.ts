import { toast } from '@/hooks/use-toast';

export class OfflineError extends Error {
  constructor(message = "You are offline") {
    super(message);
    this.name = "OfflineError";
  }
}

interface SafeFetchOptions extends RequestInit {
  timeout?: number;
  silent?: boolean; // If true, suppresses global toast on offline/error
}

/**
 * A wrapper around fetch that handles:
 * 1. Offline detection (throws OfflineError immediately)
 * 2. Timeouts (aborts request after X ms)
 * 3. Consistent error formatting
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  // 1. Offline Check
  if (typeof window !== 'undefined' && !window.navigator.onLine) {
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

  const { timeout = 10000, signal, ...fetchOptions } = options;
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

      // Client-only: emit upgrade event (handled by dashboard listener)
      if (typeof window !== 'undefined' && (response.status === 402 || response.status === 429)) {
        try {
          const clone = response.clone();
          const body = await clone.json();
          const context = body?.error?.code === 'UPGRADE_REQUIRED' ? body.error : body;
          if (context?.code === 'UPGRADE_REQUIRED') {
            window.dispatchEvent(new CustomEvent('au-upgrade-required', { detail: context }));
          }
        } catch {
        }
      }
      
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
      
      const isAbort = error.name === 'AbortError';
      const isNetworkError = !isAbort; // Fetch only throws on network error (DNS, etc)

      // If it's a network error or timeout, and we have retries left, retry
      if ((isNetworkError || isAbort) && attempt < MAX_RETRIES) {
        attempt++;
        const delay = 1000 * attempt; // 1s, 2s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (isAbort) {
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
