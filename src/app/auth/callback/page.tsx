'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase-client/client';
import { syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import { markAuthSessionRestored, markAuthUnauthenticated } from '@/lib/auth/session-expiry-events';
import { sanitizeLocalRedirectPath } from '@/lib/auth/redirects';

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
  const nextPath = useMemo(() => sanitizeLocalRedirectPath(searchParams.get('next')), [searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function completeAuth() {
      const code = searchParams.get('code');
      const authError = searchParams.get('error') || searchParams.get('error_description');

      debugAuthCallback('start', {
        hasCode: Boolean(code),
        hasError: Boolean(authError),
        nextPath,
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
          nextPath,
        });
        if (!cancelled) {
          setMessage('No authentication code was found.');
          router.replace(safeLoginRedirect(nextPath, 'session_expired'));
        }
        return;
      }

      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) throw error;

        const session = data.session;
        if (!session?.access_token || !session.user?.id) {
          markAuthUnauthenticated('auth-callback', 'session_missing');
          if (!cancelled) {
            setMessage('No active session was created.');
            router.replace(safeLoginRedirect(nextPath, 'session_expired'));
          }
          return;
        }

        syncServerAuthSessionCookie(session);
        markAuthSessionRestored('auth-callback');
        debugAuthCallback('success', {
          hasSession: true,
          hasUser: Boolean(session.user?.id),
          nextPath,
        });

        if (!cancelled) {
          setMessage('Taking you to DataCube AU...');
          router.replace(nextPath);
        }
      } catch {
        markAuthUnauthenticated('auth-callback', 'exchange_failed');
        debugAuthCallback('failed', {
          hasSession: false,
          nextPath,
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
  }, [nextPath, router, searchParams]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </main>
  );
}
