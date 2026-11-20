'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, LogOut, RefreshCw, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase-client/client';
import { clearServerAuthSessionCookie, syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';

const SESSION_TIMEOUT_MS = 10_000;
const HANDOFF_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(label)), timeoutMs);
    }),
  ]);
}

function MobileAuthCompletion() {
  const searchParams = useSearchParams();
  const state = searchParams.get('state') || '';
  const codeChallenge = searchParams.get('code_challenge') || '';
  const [message, setMessage] = useState('Checking your authenticated session…');
  const [intentUrl, setIntentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function completeMobileAuth() {
      setBusy(true);
      setError(null);
      setIntentUrl(null);
      setAuthenticated(false);

      if (!/^[A-Za-z0-9_-]{40,64}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
        setBusy(false);
        setError('This mobile sign-in request is invalid. Return to the DataCube AU app and start again.');
        setMessage('Sign-in request could not be verified.');
        return;
      }

      try {
        setMessage('Checking your authenticated browser session…');
        const { data: current, error: sessionError } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_TIMEOUT_MS,
          'Checking your session took too long. Check your connection and retry.',
        );
        if (sessionError) throw sessionError;
        const browserSession = current.session;

        if (!browserSession?.access_token || !browserSession.user?.id) {
          throw new Error('Your Google account was verified, but this browser has no active DataCube AU session. Sign in again to continue.');
        }

        syncServerAuthSessionCookie(browserSession);
        setMessage('Account verified. Preparing your secure app session…');

        const response = await withTimeout(
          fetch('/api/auth/mobile-handoff', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${browserSession.access_token}`,
            },
            body: JSON.stringify({ action: 'issue', state, codeChallenge }),
          }),
          HANDOFF_TIMEOUT_MS,
          'The secure app-session service did not respond within 20 seconds. Check your connection and retry.',
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok !== true || typeof payload?.handoffCode !== 'string') {
          throw new Error(payload?.message || `The secure app session could not be prepared (HTTP ${response.status}).`);
        }

        // The handoff contains an independent native refresh-token session.
        // Close the browser's local session now so a failed app handoff cannot
        // leave the website authenticated while the Android app is not.
        const { error: browserSignOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (browserSignOutError) {
          throw new Error('The app session was prepared, but the browser session could not be safely closed. Please retry.');
        }
        clearServerAuthSessionCookie();

        sessionStorage.setItem('datacube.au.mobile.handoff.v1', JSON.stringify({
          code: payload.handoffCode,
          state,
          createdAt: Date.now(),
        }));

        const fallbackUrl = new URL('/mobile-auth/install?app=missing', window.location.origin).toString();
        const deepLink = `intent://auth-callback?code=${encodeURIComponent(payload.handoffCode)}&state=${encodeURIComponent(state)}#Intent;scheme=datacube;package=au.datacube.app;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;

        if (cancelled) return;
        setIntentUrl(deepLink);
        setAuthenticated(true);
        setBusy(false);
        setMessage('Authenticated. Your separate app session is ready. The browser session has been closed. Returning to the app…');

        // The browser tab remains a useful authenticated confirmation page after
        // Android takes focus. The user can manually reopen the app or sign out.
        window.location.href = deepLink;
      } catch (caught) {
        if (cancelled) return;
        const detail = caught instanceof Error ? caught.message : 'An unexpected error interrupted mobile sign-in.';
        setBusy(false);
        setError(detail);
        setMessage('Your app sign-in could not be completed.');
      }
    }

    void completeMobileAuth();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [state, codeChallenge, attempt]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      clearServerAuthSessionCookie();
      sessionStorage.removeItem('datacube.au.mobile.handoff.v1');
      window.location.replace('/login');
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-5 py-10 text-center">
      <section className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-7 shadow-xl">
        {authenticated ? (
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        ) : busy ? (
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
        ) : (
          <Smartphone className="mx-auto h-11 w-11 text-muted-foreground" />
        )}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">DataCube AU</h1>
          <p className="text-sm font-semibold">{authenticated ? 'Authenticated' : busy ? 'Completing sign-in' : 'Sign-in status'}</p>
          <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p>
          {error ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
          ) : null}
        </div>

        {intentUrl ? (
          <a
            href={intentUrl}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
          >
            <Smartphone className="h-4 w-4" />
            Open DataCube AU
          </a>
        ) : null}

        {error && !busy ? (
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-5 py-2 text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            Retry secure app sign-in
          </button>
        ) : null}

        {authenticated ? (
          <p className="text-xs text-muted-foreground">
            This page will remain available in your browser. If the app did not open, use the button above.
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut || busy}
          className="inline-flex min-h-10 items-center justify-center gap-2 text-sm text-muted-foreground underline underline-offset-4 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {loggingOut ? 'Signing out…' : 'Log out'}
        </button>
      </section>
    </main>
  );
}

export default function MobileAuthCompletePage() {
  return (
    <Suspense fallback={<main className="flex min-h-dvh items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /><span className="sr-only">Loading authentication status</span></main>}>
      <MobileAuthCompletion />
    </Suspense>
  );
}
