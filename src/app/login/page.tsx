'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { hasServerAuthSessionCookie, syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import { sanitizeLocalRedirectPath } from '@/lib/auth/redirects';
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';

export default function LoginPage() {
  const { signInWithGoogle } = useSmartAuth();
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isResolvingRedirect, setIsResolvingRedirect] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [user, , isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectToParam = searchParams.get('redirectTo');
  const sessionReasonParam = searchParams.get('reason');
  const noticeParam = searchParams.get('notice');
  const wasSessionExpired = sessionReasonParam === 'session_expired';
  const hadAuthError = sessionReasonParam === 'auth_error';
  const safeRedirectPath = sanitizeLocalRedirectPath(redirectToParam);

  useEffect(() => {
    if (isUserLoading || !user) return;

    let cancelled = false;

    const resolveRedirect = async () => {
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

      try {
        setIsResolvingRedirect(true);
        const accessToken = await ensureServerSession();
        if (!accessToken) {
          await signOutAndStop();
          return;
        }

        const { data: validated, error: validateError } = await supabase.auth.getUser(accessToken);
        if (validateError || !validated?.user?.id || validated.user.id !== user.id) {
          await signOutAndStop();
          return;
        }

        if (!hasServerAuthSessionCookie()) {
          await signOutAndStop();
          return;
        }

        if (safeRedirectPath === '/conex' || safeRedirectPath.startsWith('/conex/')) {
          const response = await fetch('/conex/users?mode=access', {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            cache: 'no-store',
          });

          if (cancelled) return;

          if (response.ok) {
            router.replace(safeRedirectPath);
            return;
          }

          if (response.status === 403) {
            toast({
              title: 'Admin access required',
              description: 'Sign in with the authorized DataCube AU administrator Google account.',
              variant: 'destructive',
            });
            router.replace('/checkout');
            return;
          }

          if (response.status === 401) {
            await signOutAndStop();
            return;
          }

          router.replace('/checkout');
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
  }, [user, isUserLoading, router, safeRedirectPath, toast]);

  const handleGoogleSignIn = async () => {
    if (isLoadingGoogle) return;

    setIsLoadingGoogle(true);
    setAuthError(null);

    try {
      // OAuth returns to the verified website callback, which then resumes
      // either Conex Admin, subscription checkout, or the Android handoff.
      await signInWithGoogle(safeRedirectPath);
    } catch (error: unknown) {
      setIsLoadingGoogle(false);
      setAuthError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not start Google sign-in. Please try again.',
      );
    }
  };

  if (isResolvingRedirect || (isUserLoading && Boolean(user))) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Restoring your session" />
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-transparent px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="mx-auto mb-4 flex items-center justify-center" aria-label="DataCube AU home">
            <Icons.logo className="h-10 w-10 text-primary" />
          </Link>
          <CardTitle className="font-headline text-3xl">Welcome to DataCube AU</CardTitle>
          <CardDescription>
            {wasSessionExpired
              ? 'Your session expired. Continue securely with Google.'
              : hadAuthError
                ? 'Google authentication could not be completed. Please try again.'
                : noticeParam === 'mobile_app_required'
                  ? 'Your documents and study workspace are available in the DataCube AU Android app.'
                  : 'Use your Google account to securely access DataCube AU.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4">
          {authError ? (
            <Alert variant="destructive">
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            onClick={handleGoogleSignIn}
            className="h-12 w-full"
            variant="outline"
            disabled={isLoadingGoogle}
          >
            {isLoadingGoogle ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Icons.google className="mr-2 h-5 w-5" />
            )}
            {isLoadingGoogle ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Sign in using the Google account associated with your DataCube AU access.
          </p>
        </CardContent>
      </Card>

      <footer className="mt-8 max-w-md text-center text-sm text-muted-foreground">
        By continuing, you agree to our{' '}
        <Link href="/policy#terms" className="text-primary underline underline-offset-4">Terms of Service</Link>
        {' '}and{' '}
        <Link href="/policy#privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link>.
        <p className="mt-2">DataCube AU is a product of Zahed Investment Ltd (RC 8127949).</p>
      </footer>
    </main>
  );
}
