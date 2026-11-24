'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase-client/client';
import { syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import { markAuthSessionRestored, markAuthUnauthenticated } from '@/lib/auth/session-expiry-events';
import { isMobileAuthorizationDestination, sanitizeLocalRedirectPath } from '@/lib/auth/redirects';

// A callback can be mounted more than once (for example during React remounts).
// PKCE authorization codes are single-use, so share one exchange promise per code.
let callbackExchangeCode: string | null = null;
let callbackExchangePromise: ReturnType<typeof supabase.auth.exchangeCodeForSession> | null = null;

function exchangeOAuthCodeOnce(code: string) {
  if (callbackExchangeCode !== code || !callbackExchangePromise) {
    callbackExchangeCode = code;
    callbackExchangePromise = supabase.auth.exchangeCodeForSession(code);
  }
  return callbackExchangePromise;
}

function safeLoginRedirect(nextPath: string, reason: 'auth_error' | 'session_expired'): string {
  return `/login?redirectTo=${encodeURIComponent(nextPath)}&reason=${reason}`;
}

function debugAuthCallback(message: string, details: Record<string, unknown>): void {
  if (process.env.NEXT_PUBLIC_DCAU_AUTH_DEBUG !== '1') return;
  console.info('[auth-callback]', {
    ...details,
    message,
  });
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState('Completing sign in...');
  const nextPath = useMemo(() => sanitizeLocalRedirectPath(searchParams.get('next'), '/'), [searchParams]);
  const isMobileDestination = isMobileAuthorizationDestination(nextPath);

  useEffect(() => {
    let cancelled = false;
    const debugPath = isMobileDestination ? '/mobile-auth' : nextPath;

    async function completeAuth() {
      const code = searchParams.get('code');
      const authError = searchParams.get('error') || searchParams.get('error_description');

      debugAuthCallback('start', {
        hasCode: Boolean(code),
        hasError: Boolean(authError),
        nextPath: debugPath,
      });

      if (authError) {
        markAuthUnauthenticated('auth-callback', 'provider_error');
        if (!cancelled) {
          setMessage('Authentication could not be completed.');
          router.replace(safeLoginRedirect(nextPath, 'auth_error'));
        }
        return;
      }

      if (!code) {
        markAuthUnauthenticated('auth-callback', 'missing_code');
        debugAuthCallback('missing_code', {
          hasSession: false,
          nextPath: debugPath,
        });
        if (!cancelled) {
          setMessage('Sign-in did not finish. Please try again.');
          router.replace(safeLoginRedirect(nextPath, 'session_expired'));
        }
        return;
      }

      try {
        const { data, error } = await exchangeOAuthCodeOnce(code);

        if (error) throw error;

        const session = data.session;
        if (!session?.access_token || !session.user?.id) {
          markAuthUnauthenticated('auth-callback', 'session_missing');
          if (!cancelled) {
            setMessage('Sign-in did not finish. Please try again.');
            router.replace(safeLoginRedirect(nextPath, 'session_expired'));
          }
          return;
        }

        syncServerAuthSessionCookie(session);
        markAuthSessionRestored('auth-callback');
        debugAuthCallback('success', {
          hasSession: true,
          hasUser: Boolean(session.user?.id),
          nextPath: debugPath,
        });

        if (!cancelled) {
          if (isMobileDestination) {
            router.replace(nextPath);
            return;
          }
          setMessage('Checking account access...');
          const isConexDestination = nextPath === '/conex' || nextPath.startsWith('/conex/');
          let accessResponse: Response | null = null;
          try {
            accessResponse = await fetch('/conex/users?mode=access', {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              cache: 'no-store',
            });
          } catch {
            // A temporary Conex check outage must not block an ordinary user sign-in.
            if (isConexDestination) {
              router.replace('/');
              return;
            }
          }

          if (cancelled) return;
          if (accessResponse?.ok) {
            router.replace('/conex');
            return;
          }
          if (isConexDestination && accessResponse?.status === 403) {
            router.replace('/');
            return;
          }
          if (accessResponse?.status === 401) {
            markAuthUnauthenticated('auth-callback', 'admin_access_session_invalid');
            router.replace(safeLoginRedirect(nextPath, 'session_expired'));
            return;
          }

          setMessage('Taking you to DataCube AU...');
          router.replace(nextPath);
        }
      } catch {
        markAuthUnauthenticated('auth-callback', 'exchange_failed');
        debugAuthCallback('failed', {
          hasSession: false,
          nextPath: debugPath,
        });
        if (!cancelled) {
          setMessage('Authentication could not be completed.');
          router.replace(safeLoginRedirect(nextPath, 'auth_error'));
        }
      }
    }

    void completeAuth();

    return () => {
      cancelled = true;
    };
  }, [isMobileDestination, nextPath, router, searchParams]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </main>
  );
}
