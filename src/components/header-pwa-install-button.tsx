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

const IOS_INSTALL_DISMISSED_KEY = 'dcau:pwa-ios-install-dismissed';

const HeaderPwaInstallButton = () => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [iosInstructionsDismissed, setIosInstructionsDismissed] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsStandalone(true);
      return;
    }

    // Check for iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);
    setIosInstructionsDismissed(localStorage.getItem(IOS_INSTALL_DISMISSED_KEY) === 'true');

    // Listen for the install prompt
    const handleBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
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
      await installPrompt.userChoice.catch(() => null);
      setInstallPrompt(null);
    }
  };

  const canInstall = (installPrompt || (isIOS && !iosInstructionsDismissed)) && !isStandalone;

  if (!canInstall) {
    return null; // Don't render the button if it can't be installed or is already installed
  }

  return (
    <>
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={handleInstallClick}
                      aria-label="Install DataCube AU"
                    >
                        <Icons.install className="h-5 w-5" />
                        <span className="sr-only">Install DataCube AU</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Install DataCube AU</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>

        <Dialog
          open={showIOSInstructions}
          onOpenChange={(nextOpen) => {
            setShowIOSInstructions(nextOpen);
            if (!nextOpen && isIOS) {
              localStorage.setItem(IOS_INSTALL_DISMISSED_KEY, 'true');
              setIosInstructionsDismissed(true);
            }
          }}
        >
            <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
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
                        <span>Tap Share, then Add to Home Screen.</span>
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
