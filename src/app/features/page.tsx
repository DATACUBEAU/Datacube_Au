import { CompanyFooter } from '@/components/company-footer';
import { PublicAuHeader, AuDownloadButton, AuFeatureGallery, offlineNote } from '@/components/public-au-showcase';

export default function FeaturesPage() {
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <PublicAuHeader active="/features"/>
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-14 sm:py-20 lg:px-8">
      <section className="mb-10 max-w-2xl">
        <p className="mb-3 text-sm font-medium text-primary">Explore AU</p>
        <h1 className="font-headline text-4xl font-bold tracking-tight sm:text-6xl">Learn it your way.</h1>
        <p className="mt-4 text-lg text-muted-foreground">From a first question to a clearer understanding.</p>
      </section>
      <AuFeatureGallery/>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{offlineNote} Feature previews are illustrations.</p>
      <div className="mt-10 border-t pt-8"><AuDownloadButton/></div>
    </main>
    <CompanyFooter/>
  </div>;
}
