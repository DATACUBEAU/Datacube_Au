'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { CommunityPopup } from '@/components/community-popup';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
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
  setAuthActionsDisabled,
} from '@/lib/auth/session-expiry-events';

/**
 * Global component to mount all real-time listeners (Broadcasts, Direct Messages).
 * Handles the logic of identifying if the user is authenticated.
 */
export function GlobalListeners() {
  const { toast } = useToast();
  const router = useRouter();
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [isReauthing, setIsReauthing] = useState(false);

  const handleReLogin = useCallback(async () => {
    setIsReauthing(true);
    try {
      await supabase.auth.getSession();
      await supabase.auth.refreshSession().catch(() => null);
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user?.id) {
        clearAuthActionsDisabled();
        setShowReauthModal(false);
        toast({
          title: 'Session restored',
          description: 'You can continue where you left off.',
        });
        return;
      }
      router.push('/login?reauth=1');
    } catch {
      router.push('/login?reauth=1');
    } finally {
      setIsReauthing(false);
    }
  }, [router, toast]);

  const handleReauthCancel = useCallback(() => {
    setAuthActionsDisabled(true);
    setShowReauthModal(false);
    toast({
      title: 'Actions disabled',
      description: 'Sign in again to continue uploads, chat, and generation.',
    });
  }, [toast]);
  
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
      setShowReauthModal(true);
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired as EventListener);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired as EventListener);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        clearAuthActionsDisabled();
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
          if (!open && showReauthModal) {
            handleReauthCancel();
            return;
          }
          setShowReauthModal(open);
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
            <AlertDialogCancel disabled={isReauthing}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleReLogin()} disabled={isReauthing}>
              {isReauthing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Re-login
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
