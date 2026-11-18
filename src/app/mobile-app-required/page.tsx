import Link from 'next/link';

export default function MobileAppRequiredPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12 text-center">
      <div className="w-full max-w-lg space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">DataCube AU</p>
        <h1 className="text-3xl font-bold">Continue in the Android app</h1>
        <p className="text-muted-foreground">
          The browser-based product workspace has been retired. Documents, study tools and AU Chat
          are available in the DataCube AU Android app. Install and open the app, then choose Sign In
          or Create Account. Authentication will continue through the existing secure website login.
        </p>
        <p className="text-sm text-muted-foreground">
          Account, subscription, billing and Conex Admin services remain available on the website.
        </p>
        <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-5 py-2 text-sm font-semibold">
          Website home
        </Link>
      </div>
    </main>
  );
}
