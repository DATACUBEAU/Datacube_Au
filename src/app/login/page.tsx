'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';
import {
  hasServerAuthSessionCookie,
  syncServerAuthSessionCookie,
} from '@/lib/auth/session-cookie';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { isMobileAuthorizationDestination, isDownloadDestination, looksLikeMobileAuthDestination, readMobileOAuthDestination, sanitizeRedirectTarget } from '@/lib/auth/redirects';

export default function LoginPage() {
  const { signInWithGoogle } = useSmartAuth();
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isResolvingRedirect, setIsResolvingRedirect] = useState(false);
  const [forceReauthReady, setForceReauthReady] = useState(false);
  const forceReauthTaskRef = useRef<{ path: string; task: Promise<void> } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [user, , isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectToParam = searchParams.get('redirectTo');
  const forceReauth = searchParams.get('forceReauth') === '1';
  const sessionReasonParam = searchParams.get('reason');
  const wasSessionExpired = sessionReasonParam === 'session_expired';
  const hadAuthError = sessionReasonParam === 'auth_error';
  const requestedRedirectPath = sanitizeRedirectTarget(
    redirectToParam,
    typeof window === 'undefined' ? null : window.location.origin,
    '/',
  );
  let pendingMobile: string | null = null;
  if (typeof window !== 'undefined') {
    try { pendingMobile = readMobileOAuthDestination(window.sessionStorage); } catch {}
  }
  const safeRedirectPath = pendingMobile && isDownloadDestination(requestedRedirectPath)
    ? pendingMobile : requestedRedirectPath;
  const isMobileDestination = isMobileAuthorizationDestination(safeRedirectPath);
  const lostMobileRequest = looksLikeMobileAuthDestination(redirectToParam) && !isMobileDestination;
  const isConexDestination = safeRedirectPath === '/conex' || safeRedirectPath.startsWith('/conex/');

  useEffect(() => {
    if (isUserLoading || lostMobileRequest) return;

    let cancelled = false;

    if (forceReauth) {
      setForceReauthReady(false);
      setIsResolvingRedirect(true);
      // SIGNED_OUT can re-run this effect as user changes. Reuse the same
      // cleanup promise instead of starting another destructive sign-out.
      if (forceReauthTaskRef.current?.path !== safeRedirectPath) {
        forceReauthTaskRef.current = { path: safeRedirectPath, task: explicitSignOut(user?.id ?? null) };
      }
      void forceReauthTaskRef.current.task.then(() => {
        if (!cancelled) setForceReauthReady(true);
      }).catch(() => {
        if (!cancelled) setAuthError('Could not clear the previous website session. Reload this page and try again.');
      }).finally(() => {
        if (!cancelled) setIsResolvingRedirect(false);
      });
      return () => { cancelled = true; };
    }

    if (!user) return;

    const signOutAndStop = async () => {
      await explicitSignOut(user.id);
      if (!cancelled) setIsResolvingRedirect(false);
    };

    const validateServerSessionCookie = async (): Promise<boolean> => {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      return response.ok;
    };

    const ensureServerSession = async (): Promise<string | null> => {
      const { data: initialSessionData } = await supabase.auth.getSession();
      let activeSession = initialSessionData.session;

      if (!activeSession?.access_token) {
        const fallbackToken = await getSupabaseAccessToken();
        if (!fallbackToken) return null;
        const { data: fallbackSessionData } = await supabase.auth.getSession();
        activeSession = fallbackSessionData.session;
      }

      if (!activeSession?.access_token) return null;

      syncServerAuthSessionCookie(activeSession);
      if (!hasServerAuthSessionCookie()) return null;
      if (await validateServerSessionCookie()) return activeSession.access_token;

      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session?.access_token) return null;

      activeSession = refreshed.session;
      syncServerAuthSessionCookie(activeSession);
      if (!hasServerAuthSessionCookie()) return null;

      return (await validateServerSessionCookie()) ? activeSession.access_token : null;
    };

    const resolveRedirect = async () => {
      try {
        setIsResolvingRedirect(true);
        const token = await ensureServerSession();
        if (!token) {
          await signOutAndStop();
          return;
        }

        const { data: validated, error: validateError } = await supabase.auth.getUser(token);
        if (validateError || !validated?.user?.id || !hasServerAuthSessionCookie()) {
          await signOutAndStop();
          return;
        }
        if (cancelled) return;

        if (isMobileDestination) {
          router.replace(safeRedirectPath);
          return;
        }

        if (isConexDestination || safeRedirectPath === '/') {
          const response = await fetch('/conex/users?mode=access', {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            cache: 'no-store',
          });

          if (cancelled) return;
          if (response.ok) {
            router.replace('/conex');
            return;
          }
          if (response.status === 403) {
            router.replace('/');
            return;
          }
          if (response.status === 401) {
            await signOutAndStop();
            return;
          }
          router.replace(isConexDestination ? '/' : safeRedirectPath);
          return;
        }

        router.replace(safeRedirectPath);
      } catch {
        await signOutAndStop();
      }
    };

    void resolveRedirect();

    return () => {
      cancelled = true;
    };
  }, [user, isUserLoading, router, safeRedirectPath, isMobileDestination, isConexDestination, forceReauth, lostMobileRequest]);

  const handleGoogleSignIn = async () => {
    if (lostMobileRequest || isLoadingGoogle || isUserLoading || (forceReauth && !forceReauthReady)) return;
    setIsLoadingGoogle(true);
    setAuthError(null);

    try {
      await signInWithGoogle(safeRedirectPath);
    } catch (error: any) {
      const message = !isMobileDestination && error?.message
        ? error.message
        : 'Could not start Google sign-in. Please try again.';
      setAuthError(message);
      toast({
        variant: 'destructive',
        title: 'Sign-in failed',
        description: message,
      });
      setIsLoadingGoogle(false);
    }
  };

  if (lostMobileRequest) {
    return <main className="flex min-h-dvh items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Return to DataCube AU</h1>
        <p role="alert" className="text-sm text-muted-foreground">Your app sign-in request is missing or invalid. Reopen your installed app and start authentication again.</p>
      </div>
    </main>;
  }

  if (isResolvingRedirect || (isUserLoading && Boolean(user))) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Loading" />
      </main>
    );
  }

  return (
    <main className="dcau-auth-stage relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10">
      <div className="dcau-auth-scene" aria-hidden="true">
        <div className="dcau-auth-scene__grid" />
        <div className="dcau-auth-scene__orb" />
        <div className="dcau-auth-scene__ring dcau-auth-scene__ring--one" />
        <div className="dcau-auth-scene__ring dcau-auth-scene__ring--two" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <Card className="dcau-auth-card border-white/10 bg-background/75 shadow-2xl shadow-primary/10 backdrop-blur-2xl">
          <CardHeader className="items-center space-y-3 pb-5 text-center">
            <div className="dcau-auth-mark">
              <span className="dcau-auth-mark__halo" />
              <span className="dcau-auth-mark__ring" />
              <img src="/icon.svg" alt="DataCube AU" className="dcau-auth-mark__image h-[92px] w-[92px]" />
            </div>
            <div className="space-y-1">
              <CardTitle className="font-headline text-2xl font-semibold tracking-tight">
                Welcome to DataCube AU
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Your knowledge, beautifully connected.
              </p>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4">
            {authError ? (
              <Alert variant="destructive">
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            ) : null}
            {wasSessionExpired || hadAuthError ? (
              <p className="text-center text-sm text-muted-foreground">
                {wasSessionExpired ? 'Please sign in again.' : 'Sign-in did not finish. Please try again.'}
              </p>
            ) : null}

            <Button
              type="button"
              onClick={handleGoogleSignIn}
              className="h-12 w-full rounded-xl text-sm font-semibold shadow-lg shadow-primary/15"
              variant="outline"
              disabled={isLoadingGoogle || isUserLoading || (forceReauth && !forceReauthReady)}
            >
              {isLoadingGoogle ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Icons.google className="mr-2 h-4 w-4" />
              )}
              {isLoadingGoogle ? 'Connecting…' : 'Continue with Google'}
            </Button>

            <p className="text-center text-xs text-muted-foreground/80">
              Secure sign-in
            </p>
          </CardContent>
        </Card>

        <footer className="mt-5 flex items-center justify-center gap-4 text-xs text-muted-foreground/70">
          <Link href="/policy#terms" className="transition-colors hover:text-foreground">Terms</Link>
          <span aria-hidden="true">•</span>
          <Link href="/policy#privacy" className="transition-colors hover:text-foreground">Privacy</Link>
        </footer>
      </div>
    </main>
  );
}
