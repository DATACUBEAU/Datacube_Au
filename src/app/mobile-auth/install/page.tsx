'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const HANDOFF_KEY = 'datacube.au.mobile.handoff.v1';
const VALUE_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

export default function MobileAuthInstallPage() {
  const [intentUrl, setIntentUrl] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw) as { code?: string; state?: string; createdAt?: number };
      if (
        typeof pending.code !== 'string' ||
        typeof pending.state !== 'string' ||
        typeof pending.createdAt !== 'number' ||
        !VALUE_PATTERN.test(pending.code) ||
        !VALUE_PATTERN.test(pending.state) ||
        Date.now() - pending.createdAt > 5 * 60 * 1000
      ) {
        sessionStorage.removeItem(HANDOFF_KEY);
        return;
      }

      setIntentUrl(
        `intent://auth-callback?code=${encodeURIComponent(pending.code)}&state=${encodeURIComponent(pending.state)}#Intent;scheme=datacube;package=au.datacube.app;end`
      );
    } catch {
      sessionStorage.removeItem(HANDOFF_KEY);
    }
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12 text-center">
      <div className="w-full max-w-lg space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">DataCube AU</p>
        <h1 className="text-3xl font-bold">Authentication successful</h1>
        <p className="text-muted-foreground">
          Your website sign-in was successful. Open DataCube AU on this Android device to continue.
          If the app is not installed, install it first, then start Sign In from the app to connect
          this device to your account.
        </p>
        {intentUrl ? (
          <a href={intentUrl} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">
            Open DataCube AU
          </a>
        ) : null}
        <div>
          <Link href="/" className="text-sm font-medium text-primary underline underline-offset-4">
            Website home
          </Link>
        </div>
      </div>
    </main>
  );
}
