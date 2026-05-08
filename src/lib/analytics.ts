import { supabase } from '@/lib/supabase-client/client';

// Simple queue to prevent flooding the network with log requests
const LOG_QUEUE: Array<{name: string, params: any, tier?: string, timestamp: string}> = [];
let isFlushing = false;
let flushInterval: NodeJS.Timeout | null = null;

const PROCESS_INTERVAL_MS = 2000;
const BATCH_SIZE = 5;

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
    
    // If no token, we can't log securely. Drop logs to prevent memory leaks.
    if (!token) {
      LOG_QUEUE.length = 0; 
      isFlushing = false;
      return;
    }

    // Take a batch
    const batch = LOG_QUEUE.splice(0, BATCH_SIZE);
    
    // Insert batch directly into Supabase — no Edge Function proxy needed.
    const rows = batch.map(item => ({
      event_name: item.name,
      event_params: item.params,
      tier: item.tier || null,
      client_timestamp: item.timestamp,
      created_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('au_activity_log')
      .insert(rows);

    if (error) {
      // If the table doesn't exist, silently discard. Analytics should not crash the app.
      const code = String((error as any)?.code || '');
      if (code !== '42P01') {
        console.warn('[Analytics] Direct insert failed:', error.message);
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
