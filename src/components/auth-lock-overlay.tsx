'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { useSmartAuth } from '@/hooks/use-smart-auth';

export function AuthLockOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, session, isAuthLocked, runtimeAuthState, startReauth } = useSmartAuth();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastVisibleRef = useRef<boolean>(false);

  const shouldShow = isAuthLocked && !pathname?.startsWith('/login');

  useEffect(() => {
    const appShell = document.getElementById('app-shell');
    if (shouldShow) {
      actionButtonRef.current?.focus();
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
    if (lastVisibleRef.current === shouldShow) return;
    lastVisibleRef.current = shouldShow;
    if (!shouldShow) {
      setIsRedirecting(false);
    }
    console.info(shouldShow ? '[auth-overlay] shown' : '[auth-overlay] hidden', {
      runtimeAuthState,
      pathname,
    });
  }, [runtimeAuthState, pathname, shouldShow]);

  const handleSignIn = useCallback(async () => {
    if (isRedirecting) return;
    setIsRedirecting(true);
    startReauth('auth-lock-overlay');

    const redirectTarget = pathname || '/dashboard';
    try {
      await explicitSignOut(session?.user?.id ?? user?.id ?? null, { preserveAuthLock: true });
    } catch {
      // Continue to login redirect regardless of local sign-out cleanup outcome.
    } finally {
      console.info('[auth-overlay] redirecting to login', {
        redirectTo: redirectTarget,
      });
      router.replace(`/login?redirectTo=${encodeURIComponent(redirectTarget)}`);
    }
  }, [isRedirecting, pathname, router, session?.user?.id, startReauth, user?.id]);

  if (!shouldShow) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-lock-title"
      aria-describedby="auth-lock-description"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          actionButtonRef.current?.focus();
        }
      }}
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl">
        <h2 id="auth-lock-title" className="text-xl font-semibold">
          Session expired. Please sign in again.
        </h2>
        <p id="auth-lock-description" className="mt-2 text-sm text-muted-foreground">
          Access is locked until authentication is restored.
        </p>
        <Button
          ref={actionButtonRef}
          onClick={() => void handleSignIn()}
          className="mt-6 w-full"
          disabled={isRedirecting}
          aria-label="Sign in again"
        >
          {isRedirecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Sign in
        </Button>
      </div>
    </div>
  );
}
