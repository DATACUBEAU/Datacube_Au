'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { claimReauthRedirect, releaseReauthRedirect } from '@/lib/auth/session-expiry-events';

export function AuthLockOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthLocked, runtimeAuthState, startReauth } = useSmartAuth();
  const hasHandledRef = useRef(false);

  const shouldShow = isAuthLocked && !pathname?.startsWith('/login');

  useEffect(() => {
    const appShell = document.getElementById('app-shell');
    if (shouldShow) {
      if (appShell) {
        appShell.setAttribute('aria-hidden', 'true');
        (appShell as any).inert = true;
      }
      document.body.style.overflow = 'hidden';
    }

    return () => {
      if (appShell) {
        appShell.removeAttribute('aria-hidden');
        (appShell as any).inert = false;
      }
      document.body.style.overflow = '';
    };
  }, [shouldShow]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (!shouldShow) return;
    console.info('[auth-overlay] active', {
      runtimeAuthState,
      pathname,
    });
  }, [runtimeAuthState, pathname, shouldShow]);

  useEffect(() => {
    if (!shouldShow) {
      hasHandledRef.current = false;
      releaseReauthRedirect();
      return;
    }
    if (hasHandledRef.current) return;
    if (!claimReauthRedirect()) return;
    hasHandledRef.current = true;
    startReauth('auth-lock-overlay:redirect');
    const redirectTarget = pathname || '/dashboard';
    if (process.env.NODE_ENV === 'development') {
      console.info('[auth-overlay] redirecting to reauthenticate', {
        redirectTo: redirectTarget,
      });
    }
    router.replace(`/login?redirectTo=${encodeURIComponent(redirectTarget)}&reason=session_expired`);
  }, [pathname, router, shouldShow, startReauth]);

  return null;
}
