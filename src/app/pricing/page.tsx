import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-medium text-primary">DataCube AU</p>
      <h1 className="mt-3 text-3xl font-bold">Local-first knowledge and productivity</h1>
      <p className="mt-4 text-muted-foreground">Use AU on compatible Android devices with downloaded models. Cloud AI and AU credits are coming soon and are not available for this launch. Model downloads and connected account services need internet access.</p>
      <p className="mt-4 text-sm text-muted-foreground">If you have an existing subscription, you can still sign in to manage your account and billing.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild><Link href="/download">Download for Android</Link></Button>
        <Button asChild variant="outline"><Link href="/login?redirectTo=%2Fdashboard%2Fsettings%2Fsubscription">Manage existing subscription</Link></Button>
      </div>
    </main>
  );
}
