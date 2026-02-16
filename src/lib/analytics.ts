import { analytics } from './firebase/client';
import { logEvent as firebaseLogEvent } from 'firebase/analytics';
import { supabase, invokeEdgeFunction } from '@/lib/supabase-client/client';

export const logEvent = async (name: string, params: Record<string, any> = {}, tier?: string) => {
  // 1. Firebase Analytics (Client Side)
  try {
    const analyticsInstance = await analytics;
    if (analyticsInstance) {
      firebaseLogEvent(analyticsInstance, name, params);
    }
  } catch (e) {
    console.warn("Firebase Analytics Error:", e);
  }

  // 2. Internal Log (Edge Function)
  try {
    // Fire and forget - use invokeEdgeFunction which handles proxy/CORS
    invokeEdgeFunction('log-event', {
        method: 'POST',
        body: {
            name,
            params,
            tier
        },
        requireAuth: false // Optional auth
    }).catch(e => console.error("Internal Log Error (Background):", e));
    
  } catch (e) {
      console.error("Internal Log Error:", e);
  }
};
