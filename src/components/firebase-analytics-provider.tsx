
'use client';

import { useCallback } from 'react';
import { useSmartAuth } from '@/hooks/use-smart-auth';

export function FirebaseAnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useSmartAuth();

  // Log to Internal DB
  const logInternal = useCallback(async (eventName: string, params?: any) => {
    try {
        const token = await getToken();
        if (!token) return;

        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/log-event`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                event_type: eventName,
                entity_id: params?.item_id || 'global',
                metadata: params
            })
        });
    } catch (e) {
        console.warn("Internal logging failed", e);
    }
  }, [getToken]);

  return <>{children}</>;
}

// Helper for other components
export const useAnalytics = () => {
    const { getToken } = useSmartAuth();
    
    const track = async (eventName: string, params?: any) => {
        // Internal
        try {
            const token = await getToken();
            if (token) {
                 fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/log-event`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        event_type: eventName,
                        entity_id: params?.item_id || 'global',
                        metadata: params
                    })
                }).catch(() => {});
            }
        } catch {}
    };

    return { track };
};
