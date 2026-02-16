'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client/client';
import { useActivity } from '@/hooks/use-activity';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { CommunityPopup } from '@/components/community-popup';

/**
 * Global component to mount all real-time listeners (Broadcasts, Direct Messages).
 * Handles the logic of identifying if the user is authenticated.
 */
export function GlobalListeners() {
  const [ids, setIds] = useState<{ userId?: string }>({});
  const { toast } = useToast();
  const router = useRouter();
  
  // Track user activity and presence
  useActivity();
  
  useEffect(() => {
      const handleLimitReached = (e: any) => {
          const detail = e.detail;
          toast({
              variant: 'destructive',
              title: "Limit Reached",
              description: detail.message || "You have reached the limit for this feature.",
              action: <ToastAction altText="Upgrade" onClick={() => router.push('/dashboard/settings/subscription')}>Upgrade</ToastAction>
          });
      };

      window.addEventListener('au_limit_reached', handleLimitReached);
      return () => window.removeEventListener('au_limit_reached', handleLimitReached);
  }, [router, toast]);

  useEffect(() => {
    // 1. Initial Check
    const checkIds = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setIds({ userId: session.user.id });
      } else {
        setIds({});
      }
    };

    checkIds();

    // 2. Listen for Auth Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setIds({ userId: session.user.id });
      } else {
        setIds({});
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return <CommunityPopup />;
}
