'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { usePathname, useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { CommunityPopup } from '@/components/community-popup';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase-client/client';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearAuthActionsDisabled,
} from '@/lib/auth/session-expiry-events';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { explicitSignOut } from '@/lib/auth/explicit-signout';

/**
 * Global component to mount all real-time listeners (Broadcasts, Direct Messages).
 * Handles the logic of identifying if the user is authenticated.
 */
export function GlobalListeners() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthed } = useSmartAuth();
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [isReauthing, setIsReauthing] = useState(false);

  const handleReLogin = useCallback(async () => {
    setIsReauthing(true);
    try {
      await explicitSignOut(null);
    } catch {
      // Continue with redirect even if sign-out cleanup partially fails.
    } finally {
      setIsReauthing(false);
      setShowReauthModal(false);
      router.replace('/login?reauth=1');
    }
  }, [router]);
  
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
    const handleExpired = () => {
      if (!isAuthed) return;
      if (pathname?.startsWith('/login')) return;
      setShowReauthModal(true);
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired as EventListener);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired as EventListener);
  }, [isAuthed, pathname]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        clearAuthActionsDisabled();
        setShowReauthModal(false);
      }
      if (event === 'SIGNED_OUT') {
        setShowReauthModal(false);
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <CommunityPopup />
      <AlertDialog
        open={showReauthModal}
        onOpenChange={(open) => {
          if (open) setShowReauthModal(true);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Session expired</AlertDialogTitle>
            <AlertDialogDescription>
              Your session expired for security reasons. No data is lost. Sign in again to restore access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => void handleReLogin()} disabled={isReauthing}>
              {isReauthing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Re-login now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
