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

  // 2. Timeout Setup
  const { timeout = 10000, signal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Link user signal if provided
  if (signal) {
      signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
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
  } finally {
    clearTimeout(timeoutId);
  }
}
