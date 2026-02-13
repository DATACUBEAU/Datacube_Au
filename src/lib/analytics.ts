import { analytics } from './firebase/client';
import { logEvent as firebaseLogEvent } from 'firebase/analytics';
import { supabase } from '@/lib/supabase-client/client';

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
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return;

    await fetch(`${supabaseUrl}/functions/v1/log-event`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
            name,
            params,
            tier
        })
    });
  } catch (e) {
      console.error("Internal Log Error:", e);
  }
};
