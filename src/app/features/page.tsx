import { CompanyFooter } from '@/components/company-footer';
import { PublicAuHeader, AuDownloadButton, AuFeatureGallery, AuSubjectExamples, offlineNote } from '@/components/public-au-showcase';

export default function FeaturesPage() {
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <PublicAuHeader active="/features"/>
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-10 sm:py-14 lg:px-8">
      <section className="mb-8 max-w-2xl">
        <h1 className="font-headline text-4xl font-bold tracking-tight sm:text-5xl">Not just chat.</h1>
        <p className="mt-3 text-lg text-muted-foreground">See what AU brings to your study sessions.</p>
      </section>
      <AuFeatureGallery/>
      <section className="mt-12">
        <h2 className="mb-4 text-2xl font-semibold tracking-tight">Different subjects. Different visuals.</h2>
        <AuSubjectExamples/>
      </section>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{offlineNote} All previews are illustrative examples.</p>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6"><p className="text-xl font-semibold">Curious? Try it.</p><AuDownloadButton/></div>
    </main>
    <CompanyFooter/>
  </div>;
}
