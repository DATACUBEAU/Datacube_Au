'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { CommunityPopup } from '@/components/community-popup';

/**
 * Global component to mount all real-time listeners (Broadcasts, Direct Messages).
 * Handles the logic of identifying if the user is authenticated.
 */
export function GlobalListeners() {
  const { toast } = useToast();
  const router = useRouter();
  
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

  return <CommunityPopup />;
}
