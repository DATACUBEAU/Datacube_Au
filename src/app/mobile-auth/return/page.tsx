import Image from 'next/image';

export default function MobileAuthReturnPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-center">
      <section className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-card p-7 shadow-xl">
        <Image src="/icon.svg" alt="DataCube AU" width={64} height={64} className="mx-auto rounded-xl" />
        <h1 className="text-2xl font-semibold">Return to DataCube AU</h1>
        <p className="text-sm text-muted-foreground">
          Reopen DataCube AU from your home screen to continue signing in.
        </p>
      </section>
    </main>
  );
}
