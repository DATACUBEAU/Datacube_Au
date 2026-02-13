'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { updateUserActivity } from '@/lib/supabase-client/client';
import { usePathname } from 'next/navigation';
import { useOnlineStatus } from '@/hooks/use-online-status';

export function useActivity() {
  const [user] = useSupabaseUser();
  const pathname = usePathname();
  const isOnline = useOnlineStatus();
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  const ping = useCallback(async () => {
    await updateUserActivity(user ?? null, { isOnline });
  }, [user, isOnline]);

  // Heartbeat & Presence
  useEffect(() => {
    ping().catch(() => {});

    // Periodic heartbeat (every 60s)
    heartbeatRef.current = setInterval(() => {
      ping().catch(() => {});
    }, 60000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [ping, pathname]);

  // Log navigation changes
  useEffect(() => {
    ping().catch(() => {});
  }, [pathname, ping]);

  return { ping };
}
