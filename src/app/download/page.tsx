'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';

type AndroidRelease = {
  schema: number;
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  notes: string;
};

export default function AndroidDownloadPage() {
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadRelease(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const result = await fetch('/api/android-update', {
        signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!result.ok) throw new Error('The latest signed APK is not available yet.');
      const data: AndroidRelease = await result.json();
      if (data.schema !== 1 ||
          !Number.isInteger(data.versionCode) ||
          !Number.isFinite(data.sizeBytes) ||
          typeof data.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(data.sha256) ||
          typeof data.apkUrl !== 'string' ||
          !/^https:\/\/github\.com\/DATACUBEAU\/Datacube_Au\/releases\/download\/android-test-[a-f0-9]{12}\/DataCube-AU-Android-arm64\.apk$/.test(data.apkUrl)) {
        throw new Error('The release information is invalid.');
      }
      setRelease(data);
    } catch (cause) {
      if (signal?.aborted) return;
      setRelease(null);
      setError(cause instanceof Error ? cause.message : 'Could not check the latest release.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadRelease(controller.signal);
    return () => controller.abort();
  }, []);

  return (
    <main className="dcau-auth-stage relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10">
      <div className="dcau-auth-scene" aria-hidden="true">
        <div className="dcau-auth-scene__grid" />
        <div className="dcau-auth-scene__orb" />
        <div className="dcau-auth-scene__ring dcau-auth-scene__ring--one" />
      </div>
      <section className="relative z-10 w-full max-w-md rounded-[28px] border border-primary/20 bg-background/85 p-6 text-center shadow-xl backdrop-blur sm:p-9">
        <div className="dcau-auth-mark mx-auto mb-5">
          <span className="dcau-auth-mark__halo" />
          <Image src="/icon.svg" alt="DataCube AU icon" width={86} height={86}
            unoptimized priority className="dcau-auth-mark__image" />
        </div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">DataCube AU</p>
        <h1 className="font-headline text-3xl font-bold tracking-tight">Get the Android app</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          One signed installation, then update from inside AU. Your app data is preserved during compatible in-place updates.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
            <Smartphone className="mb-2 h-5 w-5 text-primary" />
            <p className="text-xs font-semibold">Android 8.0+</p>
            <p className="mt-1 text-xs text-muted-foreground">ARM64 devices</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
            <ShieldCheck className="mb-2 h-5 w-5 text-primary" />
            <p className="text-xs font-semibold">Signed APK</p>
            <p className="mt-1 text-xs text-muted-foreground">Android confirms installation</p>
          </div>
        </div>
        <div className="mt-6 rounded-2xl border border-border/70 bg-background/60 p-4 text-left" aria-live="polite">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking the latest verified build…</p>
          ) : release ? (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Version {release.versionName}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {(release.sizeBytes / (1024 * 1024)).toFixed(1)} MiB · Full APK · No AI model weights
              </p>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {release.notes}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{error}</p>
          )}
        </div>
        {release ? (
          <a href={release.apkUrl}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <Download className="h-4 w-4" />
            Download Android APK
          </a>
        ) : (
          <button type="button" disabled={loading} onClick={() => void loadRelease()}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <RefreshCw className="h-4 w-4" />
            Check again
          </button>
        )}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          The APK is delivered directly by GitHub Releases, not by Vercel.
          Android may ask you to approve installation. Do not uninstall an existing compatible AU installation before updating.
        </p>
        <Link href="/" className="mt-5 inline-block text-xs text-primary hover:underline">
          Return to DataCube AU
        </Link>
      </section>
    </main>
  );
}
