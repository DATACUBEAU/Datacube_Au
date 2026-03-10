import { SiteManualGuide } from '@/components/site-manual-guide';
import { notFound } from 'next/navigation';

export default function GuidePreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return (
    <main className="min-h-dvh bg-transparent">
      <SiteManualGuide open />
    </main>
  );
}
