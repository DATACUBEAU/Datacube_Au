import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CompanyFooter } from '@/components/company-footer';
import { PublicAuHeader, AuDownloadButton, AuHeroExample, AuFeatureGallery, deviceNote, offlineNote } from '@/components/public-au-showcase';

export default function LandingPage() {
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <PublicAuHeader active="/" />
    <main className="flex-1">
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-16 md:grid-cols-2 md:py-24 lg:px-8">
        <div className="space-y-6 text-center md:text-left">
          <p className="text-sm font-medium tracking-widest text-primary">Meet AU</p>
          <h1 className="font-headline text-5xl font-bold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">Understand more.</h1>
          <p className="mx-auto max-w-md text-lg leading-relaxed text-muted-foreground md:mx-0">Ask. See the idea. Make it click.</p>
          <div className="flex flex-wrap justify-center gap-3 md:justify-start"><AuDownloadButton/><Button asChild size="lg" variant="outline"><Link href="/features">Explore AU</Link></Button></div>
          <p className="text-xs text-muted-foreground">{deviceNote}</p>
        </div>
        <AuHeroExample/>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16 lg:px-8">
        <div className="mb-7"><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">More than answers.</h2><p className="mt-2 text-sm text-muted-foreground">Learn with explanations, visuals and practice.</p></div>
        <AuFeatureGallery compact/>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{offlineNote} Feature previews are illustrations.</p>
      </section>
    </main>
    <CompanyFooter/>
  </div>;
}
