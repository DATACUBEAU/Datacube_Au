'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRouter, usePathname } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { CommunityPopup } from '@/components/community-popup';
import { AUTH_SESSION_EXPIRED_EVENT } from '@/lib/auth/session-expiry-events';

export function GlobalListeners() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handleLimitReached = (e: any) => {
      const detail = e.detail || {};
      toast({
        variant: 'destructive',
        title: 'Limit Reached',
        description: detail.message || 'You have reached the limit for this feature.',
        action: (
          <ToastAction altText="Upgrade" onClick={() => router.push('/dashboard/settings/subscription')}>
            Upgrade
          </ToastAction>
        ),
      });
    };

    window.addEventListener('au_limit_reached', handleLimitReached);
    return () => window.removeEventListener('au_limit_reached', handleLimitReached);
  }, [router, toast]);

  useEffect(() => {
    const handleExpired = (event: Event) => {
      if (process.env.NODE_ENV !== 'development' && process.env.NEXT_PUBLIC_DCAU_AUTH_DEBUG !== '1') return;
      if (pathname?.startsWith('/login') || pathname?.startsWith('/signup') || pathname?.startsWith('/session-expired')) return;
      const detail = (event as CustomEvent)?.detail || {};
      console.warn('[auth] session expired', {
        source: detail.source || null,
        reason: detail.reason || null,
        status: detail.status || null,
      });
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired as EventListener);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired as EventListener);
  }, [pathname]);

  return (
    <>
      <CommunityPopup />
    </>
  );
}
