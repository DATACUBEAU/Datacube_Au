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
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ArrowUpSquare } from 'lucide-react';
import { Icons } from './icons';

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

const HeaderPwaInstallButton = () => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsStandalone(true);
      return;
    }

    // Check for iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    // Listen for the install prompt
    const handleBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      setInstallPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
        setInstallPrompt(null);
        setIsStandalone(true);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
    } else if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('PWA installation accepted');
      } else {
        console.log('PWA installation dismissed');
      }
      setInstallPrompt(null);
    }
  };

  const canInstall = (installPrompt || isIOS) && !isStandalone;

  if (!canInstall) {
    return null; // Don't render the button if it can't be installed or is already installed
  }

  return (
    <>
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handleInstallClick}>
                        <Icons.install className="h-5 w-5" />
                        <span className="sr-only">Install App</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Install App</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>

        <Dialog open={showIOSInstructions} onOpenChange={setShowIOSInstructions}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="font-headline text-xl">Install on your Device</DialogTitle>
                    <DialogDescription>
                    To install the DataCube AU app, follow these simple steps in your browser.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <ol className="space-y-4 text-sm">
                    <li className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">1</span>
                        <span>Tap the 'Share' button (<ArrowUpSquare className="inline-block h-4 w-4 -mt-1 mx-1" />) in your browser's toolbar.</span>
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

export default HeaderPwaInstallButton;
