'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { START_PRODUCT_TOUR_EVENT } from '@/components/au-assistant';

export function SiteManualGuide({children, open, onOpenChange}: {
  children?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const shown = open ?? localOpen;
  const setShown = (value: boolean) => { if (open === undefined) setLocalOpen(value); onOpenChange?.(value); };
  return (
    <Dialog open={shown} onOpenChange={setShown}>
      {children ?? (open === undefined ? <Button variant="outline" onClick={() => setShown(true)}>AU guide</Button> : null)}
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Get started with DataCube AU</DialogTitle>
          <DialogDescription>Study in the native Android app. Use the website for downloads and account services.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p><strong className="text-foreground">1. Download AU.</strong> Get the official Android APK from the download page.</p>
          <p><strong className="text-foreground">2. Set up your models.</strong> Choose compatible models in the app. Downloads are separate from the APK.</p>
          <p><strong className="text-foreground">3. Study your documents.</strong> Import a file, ask AU questions, generate Smart Notes or practise with source-grounded questions.</p>
          <p><strong className="text-foreground">4. Keep your models safe.</strong> Save and confirm model ZIP backups in your chosen folder. Update AU without uninstalling.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { window.dispatchEvent(new CustomEvent(START_PRODUCT_TOUR_EVENT)); setShown(false); }}>Take a product tour</Button><Button asChild><Link href="/download">Download for Android</Link></Button><Button variant="outline" onClick={() => setShown(false)}>Close guide</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
