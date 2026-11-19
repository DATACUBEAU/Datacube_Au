'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Icons } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';
import {
  hasServerAuthSessionCookie,
  syncServerAuthSessionCookie,
} from '@/lib/auth/session-cookie';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { sanitizeLocalRedirectPath } from '@/lib/auth/redirects';

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
  const wasSessionExpired = sessionReasonParam === 'session_expired';
  const hadAuthError = sessionReasonParam === 'auth_error';
  const safeRedirectPath = sanitizeLocalRedirectPath(redirectToParam, '/');
  const isConexDestination = safeRedirectPath === '/conex' || safeRedirectPath.startsWith('/conex/');

  useEffect(() => {
    if (isUserLoading || !user) return;

    let cancelled = false;

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

        if (isConexDestination) {
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
            router.replace(safeRedirectPath);
            return;
          }
          if (response.status === 403) {
            router.replace('/403');
            return;
          }
          if (response.status === 401) {
            await signOutAndStop();
            return;
          }
          router.replace('/');
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
  }, [user, isUserLoading, router, safeRedirectPath, isConexDestination]);

  const handleGoogleSignIn = async () => {
    if (isLoadingGoogle) return;
    setIsLoadingGoogle(true);
    setAuthError(null);

    try {
      await signInWithGoogle(safeRedirectPath);
    } catch (error: any) {
      const message = error?.message || 'Could not start Google sign-in. Please try again.';
      setAuthError(message);
      toast({
        variant: 'destructive',
        title: 'Google sign-in failed',
        description: message,
      });
      setIsLoadingGoogle(false);
    }
  };

  if (isResolvingRedirect || (isUserLoading && Boolean(user))) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-transparent px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="mx-auto mb-4 flex items-center justify-center">
            <Icons.logo className="h-10 w-10 text-primary" />
          </Link>
          <CardTitle className="font-headline text-3xl">
            Welcome to DataCube AU
          </CardTitle>
          <CardDescription>
            {wasSessionExpired
              ? 'Your session expired. Continue with Google to sign in again.'
              : hadAuthError
                ? 'Google authentication could not be completed. Please try again.'
                : isConexDestination
                  ? 'Sign in with your authorized Google account to continue to Conex Admin.'
                  : 'Continue securely with your Google account.'}
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
            className="w-full"
            variant="outline"
            disabled={isLoadingGoogle}
          >
            {isLoadingGoogle ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icons.google className="mr-2 h-4 w-4" />
            )}
            {isLoadingGoogle ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Email and password sign-in and registration are not available. Use Google to continue.
          </p>
        </CardContent>
      </Card>

      <footer className="mt-8 text-center text-sm text-muted-foreground">
        By continuing, you agree to our{' '}
        <Link href="/policy#terms" className="text-primary underline underline-offset-4">
          Terms of Service
        </Link>
        {' '}and{' '}
        <Link href="/policy#privacy" className="text-primary underline underline-offset-4">
          Privacy Policy
        </Link>.
        <p className="mt-2">DataCube AU is a product of Zahed Investment Ltd.</p>
      </footer>
    </div>
  );
}
