import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CompanyFooter } from '@/components/company-footer';
import { PublicAuHeader, AuDownloadButton, AuHeroExample, deviceNote } from '@/components/public-au-showcase';

export default function LandingPage() {
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <PublicAuHeader active="/"/>
    <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-5 py-10 md:grid-cols-2 md:py-14 lg:px-8">
      <div className="space-y-5 text-center md:text-left">
        <h1 className="font-headline text-5xl font-bold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">Enough talk.</h1>
        <p className="text-xl leading-relaxed text-muted-foreground">Download AU. See what it can do.</p>
        <div className="flex flex-wrap justify-center gap-3 md:justify-start"><AuDownloadButton/><Button asChild variant="ghost" size="lg"><Link href="/features">Take a look</Link></Button></div>
        <p className="text-xs text-muted-foreground">{deviceNote}</p>
      </div>
      <AuHeroExample/>
    </main>
    <CompanyFooter/>
  </div>;
}
