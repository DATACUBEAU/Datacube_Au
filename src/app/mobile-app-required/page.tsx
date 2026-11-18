import Link from 'next/link';

export default function MobileAppRequiredPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12 text-center">
      <div className="w-full max-w-lg space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">DataCube AU</p>
        <h1 className="text-3xl font-bold">Continue in the Android app</h1>
        <p className="text-muted-foreground">
          The browser-based product workspace has been retired. Use the DataCube AU Android app for documents, study tools and chat. Sign-in and account creation still use this website's existing secure authentication system.
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/login" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">
            Sign In
          </Link>
          <Link href="/signup" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-5 py-2 text-sm font-semibold">
            Create Account
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Subscription management, public information and the Conex Admin Portal remain available on the website.
        </p>
      </div>
    </main>
  );
}
