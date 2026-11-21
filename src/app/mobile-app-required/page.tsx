import Image from 'next/image';
import { BookOpen, FileText, MessageCircle, Download } from 'lucide-react';

export default function MobileAppRequiredPage() {
  return (
    <main className="dcau-auth-stage relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-12">
      <div className="dcau-auth-scene" aria-hidden="true">
        <div className="dcau-auth-scene__grid" />
        <div className="dcau-auth-scene__orb" />
        <div className="dcau-auth-scene__ring dcau-auth-scene__ring--one" />
        <div className="dcau-auth-scene__ring dcau-auth-scene__ring--two" />
      </div>

      <section className="relative z-10 w-full max-w-md text-center">
        <div className="dcau-auth-mark mx-auto mb-7">
          <span className="dcau-auth-mark__halo" />
          <span className="dcau-auth-mark__ring" />
          <Image src="/icon.svg" alt="DataCube AU" width={104} height={104} priority unoptimized className="dcau-auth-mark__image" />
        </div>

        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">DataCube AU</p>
        <h1 className="font-headline text-3xl font-bold tracking-tight sm:text-4xl">
          Make more of what you know.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
          Get the app for a smarter way to explore your documents, study and chat with AU.
        </p>

        <div className="mx-auto mt-8 grid max-w-sm grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/10 bg-background/55 px-2 py-4 backdrop-blur">
            <FileText className="mx-auto mb-2 h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">Documents</span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-background/55 px-2 py-4 backdrop-blur">
            <BookOpen className="mx-auto mb-2 h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">Study</span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-background/55 px-2 py-4 backdrop-blur">
            <MessageCircle className="mx-auto mb-2 h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">AU Chat</span>
          </div>
        </div>

        <div className="mt-8">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="App download link coming soon"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground opacity-75"
          >
            <Download className="h-4 w-4" />
            Download DataCube AU
          </button>
        </div>
      </section>
    </main>
  );
}
