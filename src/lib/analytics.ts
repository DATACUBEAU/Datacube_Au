import { supabase, invokeEdgeFunction } from '@/lib/supabase-client/client';

// Simple queue to prevent flooding the network with log requests
const LOG_QUEUE: Array<{name: string, params: any, tier?: string, timestamp: string}> = [];
let isFlushing = false;
let flushInterval: NodeJS.Timeout | null = null;

const PROCESS_INTERVAL_MS = 2000;
const BATCH_SIZE = 5; // Process up to 5 events per flush (sequentially or parallel)

function isAbortLikeError(error: unknown): boolean {
  const name = String((error as any)?.name || '');
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    name === 'AbortError' ||
    message.includes('aborterror') ||
    message.includes('signal is aborted') ||
    message.includes('aborted without reason')
  );
}

function stopFlushIntervalIfIdle() {
  if (LOG_QUEUE.length === 0 && flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

const processQueue = async () => {
  if (isFlushing) return;
  if (LOG_QUEUE.length === 0) {
    stopFlushIntervalIfIdle();
    return;
  }
  if (typeof window !== 'undefined' && window.navigator.onLine === false) {
    return;
  }
  isFlushing = true;

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    
    // If no token, we can't log securely. 
    // Option: Drop logs or keep them until login? 
    // For now, we'll drop them to prevent memory leaks if user never logs in.
    if (!token) {
      LOG_QUEUE.length = 0; 
      isFlushing = false;
      return;
    }

    // Take a batch
    const batch = LOG_QUEUE.splice(0, BATCH_SIZE);
    
    // Process batch items sequentially to avoid connection pool exhaustion
    for (const item of batch) {
      try {
        await invokeEdgeFunction('log-event', {
          method: 'POST',
          requireAuth: true,
          silent: true,
          timeoutMs: 5000, // Short timeout for logs, don't hang app
          body: {
            name: item.name,
            params: item.params,
            tier: item.tier,
            client_timestamp: item.timestamp
          },
        });
      } catch (e) {
        // Silent fail for individual logs
        if (!isAbortLikeError(e)) {
          console.warn('[Analytics] Log failed', e);
        }
      }
    }
  } catch (e) {
    if (!isAbortLikeError(e)) {
      console.error('[Analytics] Flush error', e);
    }
  } finally {
    isFlushing = false;
    stopFlushIntervalIfIdle();
    // If more items, trigger another flush soon
    if (LOG_QUEUE.length > 0) {
      setTimeout(processQueue, 1000);
    }
  }
};

export const logEvent = async (name: string, params: Record<string, any> = {}, tier?: string) => {
  LOG_QUEUE.push({ 
    name, 
    params, 
    tier, 
    timestamp: new Date().toISOString() 
  });

  // Start the interval if not running
  if (!flushInterval) {
    flushInterval = setInterval(processQueue, PROCESS_INTERVAL_MS);
    // Also try to process immediately if it's the first event
    processQueue(); 
  }
};
