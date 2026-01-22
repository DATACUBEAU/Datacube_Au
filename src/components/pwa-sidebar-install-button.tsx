'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ArrowUpSquare } from 'lucide-react';
import { Icons } from './icons';

// This interface is needed to augment the global Window object
declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const PwaInstallButton = () => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setInstallPrompt(event);
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        setCanInstall(true);
      }
    };

    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    if (isIOSDevice && !window.matchMedia('(display-mode: standalone)').matches) {
      setCanInstall(true);
    }
    
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Hide the button if the app is launched in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches) {
        setCanInstall(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = () => {
    if (isIOS) {
      setShowIOSInstructions(true);
    } else if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
          setCanInstall(false);
        } else {
          console.log('User dismissed the install prompt');
        }
      });
    }
  };

  if (!canInstall) {
    return (
        <p className="text-sm text-muted-foreground">The app is already installed or your browser doesn't support installation.</p>
    );
  }

  return (
    <>
      <Button onClick={handleInstallClick}>
        <Icons.install className="mr-2 h-4 w-4" />
        Install App
      </Button>

      <Dialog open={showIOSInstructions} onOpenChange={setShowIOSInstructions}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-headline text-xl">Install on your iPhone</DialogTitle>
            <DialogDescription>
              To install the DataCube AU app, follow these simple steps in Safari.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ol className="space-y-4 text-sm">
              <li className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">1</span>
                <span>Tap the <ArrowUpSquare className="inline-block h-4 w-4 -mt-1 mx-1" /> 'Share' button in the Safari toolbar.</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">2</span>
                <span>Scroll down and tap 'Add to Home Screen'.</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">3</span>
                <span>Confirm by tapping 'Add' in the top-right corner.</span>
              </li>
            </ol>
          </div>
          <DialogFooter>
             <Button onClick={() => setShowIOSInstructions(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PwaInstallButton;
