'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase-client/client';
import { syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';

function MobileAuthCompletion() {
  const searchParams = useSearchParams();
  const state = searchParams.get('state') || '';
  const codeChallenge = searchParams.get('code_challenge') || '';
  const [message, setMessage] = useState('Preparing your secure mobile sign-in…');
  const [intentUrl, setIntentUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function completeMobileAuth() {
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
        setFailed(true);
        setMessage('This mobile sign-in request is invalid. Return to DataCube AU and try again.');
        return;
      }

      try {
        const { data: current, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const browserSession = current.session;

        if (!browserSession?.access_token || !browserSession.refresh_token || !browserSession.user?.id) {
          const redirectTo = `/mobile-auth/complete?state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}`;
          window.location.replace(`/login?mode=login&redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }

        const response = await fetch('/api/auth/mobile-handoff', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${browserSession.access_token}`,
          },
          body: JSON.stringify({
            action: 'issue',
            state,
            codeChallenge,
            refreshToken: browserSession.refresh_token,
          }),
        });

        const payload = await response.json().catch(() => ({}));

        // The server rotates the refresh token to prove the session pair belongs
        // to the authenticated browser user. Keep the website SDK synchronized
        // even when creating the handoff row fails.
        if (payload?.session?.access_token && payload?.session?.refresh_token) {
          const { data: updated, error: setSessionError } = await supabase.auth.setSession({
            access_token: payload.session.access_token,
            refresh_token: payload.session.refresh_token,
          });
          if (setSessionError) throw setSessionError;
          if (updated.session) syncServerAuthSessionCookie(updated.session);
        }

        if (!response.ok || payload?.ok !== true || typeof payload?.handoffCode !== 'string') {
          throw new Error(payload?.message || 'The secure app handoff could not be prepared.');
        }

        // Keep the one-time credential out of URLs and browser history. A
        // same-tab fallback can offer a manual app-open action from session storage.
        sessionStorage.setItem('datacube.au.mobile.handoff.v1', JSON.stringify({
          code: payload.handoffCode,
          state,
          createdAt: Date.now(),
        }));
        const fallbackUrl = new URL('/mobile-auth/install', window.location.origin).toString();
        const deepLink = `intent://auth-callback?code=${encodeURIComponent(payload.handoffCode)}&state=${encodeURIComponent(state)}#Intent;scheme=datacube;package=au.datacube.app;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;

        if (cancelled) return;
        setIntentUrl(deepLink);
        setMessage('Authentication successful. Opening DataCube AU…');

        // Chrome opens the installed Android package. If it is not installed,
        // browser_fallback_url takes the user to the install/continue page.
        window.location.href = deepLink;
      } catch (error) {
        if (cancelled) return;
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'Authentication completed, but the app handoff failed.');
      }
    }

    void completeMobileAuth();
    return () => {
      cancelled = true;
    };
  }, [state, codeChallenge]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-5 text-center">
      {!failed ? <Loader2 className="h-9 w-9 animate-spin text-primary" /> : null}
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold">DataCube AU</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {intentUrl ? (
          <a
            href={intentUrl}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
          >
            Open DataCube AU
          </a>
        ) : null}
        {failed ? (
          <a href="/login" className="block text-sm font-medium text-primary underline underline-offset-4">
            Return to sign in
          </a>
        ) : null}
      </div>
    </main>
  );
}

export default function MobileAuthCompletePage() {
  return (
    <Suspense fallback={<main className="flex min-h-dvh items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></main>}>
      <MobileAuthCompletion />
    </Suspense>
  );
}
