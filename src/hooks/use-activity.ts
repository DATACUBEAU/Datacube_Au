'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { updateUserActivity } from '@/lib/supabase-client/client';
import { usePathname } from 'next/navigation';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { logEvent } from '@/lib/analytics';

export function useActivity() {
  const [user] = useSupabaseUser();
  const pathname = usePathname();
  const { isOnline } = useNetworkStatus();
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  const ping = useCallback(async () => {
    if (!user || !isOnline) return;
    await updateUserActivity(user ?? null, { isOnline });
    await logEvent('presence_ping', { path: pathname, isOnline });
  }, [user, isOnline, pathname]);

  // Heartbeat & Presence
  useEffect(() => {
    if (!user || !isOnline) {
      return;
    }

    ping().catch(() => {});

    // Periodic heartbeat (every 60s)
    heartbeatRef.current = setInterval(() => {
      ping().catch(() => {});
    }, 60000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [isOnline, ping, pathname, user]);

  // Log navigation changes
  useEffect(() => {
    if (!user || !isOnline) return;
    ping().catch(() => {});
    logEvent('page_view', { path: pathname }).catch(() => {});
  }, [isOnline, pathname, ping, user]);

  return { ping };
}
