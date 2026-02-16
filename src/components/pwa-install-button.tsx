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
import { ArrowUpSquare, CheckCircle, Info } from 'lucide-react';
import { Icons } from './icons';

// Augment the global WindowEventMap to include the `beforeinstallprompt` event.
// This provides TypeScript with the necessary type definitions.
declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

// Define the interface for the `beforeinstallprompt` event.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const PwaInstallButton = () => {
  // State to hold the captured `beforeinstallprompt` event.
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  
  // State to determine if the device is an iOS device.
  const [isIOS, setIsIOS] = useState(false);
  
  // State to control the visibility of the installation instructions dialog for iOS.
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  
  // State to check if the app is already running in standalone (installed) mode.
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // This effect runs once on component mount to set up all necessary checks and event listeners.

    // 1. Check if the app is already running in standalone mode.
    // `window.matchMedia` is the standard way to check the display mode.
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) {
      setIsStandalone(true);
      return; // If installed, no need to set up install listeners.
    }

    // 2. Check if the device is iOS.
    // iOS Safari does not support the `beforeinstallprompt` event and requires manual installation.
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // 3. Set up the event listener for `beforeinstallprompt`.
    // This event is fired by the browser when the PWA is installable.
    // It will fire again if the user uninstalls the app.
    const handleBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      // Store the event so we can trigger it later on a button click.
      setInstallPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 4. Set up the event listener for `appinstalled`.
    // This event fires after the app has been successfully installed.
    const handleAppInstalled = () => {
        console.log('PWA was installed');
        setIsStandalone(true); // Visually update the UI to reflect installation
        setInstallPrompt(null); // The prompt can no longer be used
    };
    
    window.addEventListener('appinstalled', handleAppInstalled);

    // 5. Clean up the event listeners when the component unmounts.
    // This is crucial to prevent memory leaks.
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    // This function is triggered when the user clicks the install button.

    if (isIOS) {
      // If on iOS, we can't trigger a prompt. Instead, we show instructions.
      setShowIOSInstructions(true);
    } else if (installPrompt) {
      // For other platforms, we trigger the stored `prompt()`.
      await installPrompt.prompt();
      
      // Wait for the user to respond to the prompt.
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      // The browser will handle the prompt, so we can clear our reference.
      setInstallPrompt(null);
    }
  };

  // Determine if the install button should be available.
  // It's available if it's an iOS device (to show instructions) or if the install prompt has been captured.
  const canInstall = installPrompt || isIOS;

  return (
    <TooltipProvider>
        <div className="flex items-center gap-4">
            <Tooltip>
                <TooltipTrigger asChild>
                    {/* The button is wrapped in a span to allow the tooltip to show even when disabled */}
                    <span>
                        <Button 
                            onClick={handleInstallClick} 
                            disabled={!canInstall || isStandalone}
                            aria-label="Install App"
                        >
                            <Icons.install className="mr-2 h-4 w-4" aria-hidden="true" />
                            Install App
                        </Button>
                    </span>
                </TooltipTrigger>
                {!isIOS && (
                    <TooltipContent>
                        <p>Tip: You can also use the install icon in your browser's address bar.</p>
                    </TooltipContent>
                )}
            </Tooltip>
            
            {isStandalone && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle className="h-5 w-5" aria-hidden="true" />
                    <p className="font-medium">Application Installed</p>
                </div>
            )}
        </div>

        {/* This dialog provides instructions for iOS users. */}
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
                        <span>Tap the 'Share' button (<ArrowUpSquare className="inline-block h-4 w-4 -mt-1 mx-1" aria-hidden="true" />) in your browser's toolbar.</span>
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
    </TooltipProvider>
  );
};

export default PwaInstallButton;
