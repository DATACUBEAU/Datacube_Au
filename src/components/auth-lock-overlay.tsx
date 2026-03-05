'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { useSmartAuth } from '@/hooks/use-smart-auth';

export function AuthLockOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, session, isAuthLocked, runtimeAuthState, startReauth } = useSmartAuth();
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
      return;
    }
    if (hasHandledRef.current) return;
    hasHandledRef.current = true;
    startReauth('auth-lock-overlay:auto-logout');
    const redirectTarget = pathname || '/dashboard';
    void (async () => {
      try {
        await explicitSignOut(session?.user?.id ?? user?.id ?? null, { preserveAuthLock: true });
      } catch {
        // Continue to redirect even if client cleanup partially fails.
      } finally {
        if (process.env.NODE_ENV === 'development') {
          console.info('[auth-overlay] forced logout redirect', {
            redirectTo: redirectTarget,
          });
        }
        router.replace(`/login?redirectTo=${encodeURIComponent(redirectTarget)}&reason=session_expired`);
      }
    })();
  }, [pathname, router, session?.user?.id, shouldShow, startReauth, user?.id]);

  return null;
}
