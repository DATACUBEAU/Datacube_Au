'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { claimReauthRedirect, releaseReauthRedirect } from '@/lib/auth/session-expiry-events';
import { buildSessionExpiredPath, isPublicAuthPath, sanitizeLocalRedirectPath } from '@/lib/auth/redirects';

export function AuthLockOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthLocked, runtimeAuthState, startReauth } = useSmartAuth();
  const hasHandledRef = useRef(false);

  const shouldRedirect = isAuthLocked && !isPublicAuthPath(pathname);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (!shouldRedirect) return;
    console.info('[auth-overlay] active', {
      runtimeAuthState,
      pathname,
    });
  }, [runtimeAuthState, pathname, shouldRedirect]);

  useEffect(() => {
    if (!isAuthLocked) {
      hasHandledRef.current = false;
      releaseReauthRedirect();
      return;
    }
    if (!shouldRedirect) return;
    if (hasHandledRef.current) return;
    if (!claimReauthRedirect()) return;
    hasHandledRef.current = true;
    startReauth('auth-lock-overlay:redirect');
    const redirectTarget = sanitizeLocalRedirectPath(pathname || '/dashboard');
    if (process.env.NODE_ENV === 'development') {
      console.info('[auth-overlay] redirecting to reauthenticate', {
        redirectTo: redirectTarget,
      });
    }
    router.replace(buildSessionExpiredPath(redirectTarget));
  }, [isAuthLocked, pathname, router, shouldRedirect, startReauth]);

  return null;
}
