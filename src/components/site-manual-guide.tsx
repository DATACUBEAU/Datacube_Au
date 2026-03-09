'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Smartphone, 
  Tablet, 
  Globe, 
  Share, 
  PlusSquare, 
  Menu, 
  Download, 
  HelpCircle, 
  MessageCircle, 
  BrainCircuit, 
  ClipboardCheck, 
  FileText, 
  Monitor, 
  PenTool, 
  Settings
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export function SiteManualGuide({
  children,
  open,
  onOpenChange,
}: {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const setIsOpen = useCallback(
    (nextOpen: boolean) => {
      if (isControlled) onOpenChange?.(nextOpen);
      else setUncontrolledOpen(nextOpen);
    },
    [isControlled, onOpenChange]
  );
  const [deviceType, setDeviceType] = useState<'desktop' | 'ios' | 'android' | 'tablet' | 'unknown'>('unknown');
  const [browserType, setBrowserType] = useState<'chrome' | 'safari' | 'firefox' | 'edge' | 'other'>('other');
  const [isPwaInstalled, setIsPwaInstalled] = useState(false);

  useEffect(() => {
    // Check PWA
    if (window.matchMedia('(display-mode: standalone)').matches) setIsPwaInstalled(true);

    // Device detection
    const ua = navigator.userAgent.toLowerCase();
    const isTablet = /ipad|android/.test(ua) && !/mobile/.test(ua);
    const isIOS = /iphone|ipad|ipod/.test(ua);

    if (isTablet) setDeviceType('tablet');
    else if (isIOS) setDeviceType('ios');
    else if (/android/.test(ua)) setDeviceType('android');
    else setDeviceType('desktop');

    // Browser detection
    if (/chrome|crios/.test(ua) && !/edge|edg/.test(ua)) setBrowserType('chrome');
    else if (/safari/.test(ua) && !/chrome|crios/.test(ua)) setBrowserType('safari');
    else if (/firefox|fxios/.test(ua)) setBrowserType('firefox');
    else if (/edge|edg/.test(ua)) setBrowserType('edge');
    else setBrowserType('other');

    // Auto-open
    const hasSeenGuide = localStorage.getItem('au_site_guide_seen');
    if (!hasSeenGuide && !window.matchMedia('(display-mode: standalone)').matches) {
      setIsOpen(true);
      localStorage.setItem('au_site_guide_seen', 'true');
    }
  }, [setIsOpen]);

  const renderInstallInstructions = useCallback(() => {
    if (isPwaInstalled) return (
      <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
        <div className="rounded-full bg-green-100 p-4 dark:bg-green-900/30">
          <ClipboardCheck className="h-12 w-12 text-green-600 dark:text-green-400" />
        </div>
        <h3 className="text-xl font-semibold text-green-700 dark:text-green-300">App Installed!</h3>
        <p className="text-muted-foreground">You are currently using the installed version of DataCube AU. You're all set!</p>
      </div>
    );

    if (deviceType === 'desktop') return (
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
          <Monitor className="h-5 w-5 text-primary" />
          <span className="font-semibold">Detected: Desktop / Laptop ({browserType})</span>
        </div>
        {(browserType === 'chrome' || browserType === 'edge') ? (
          <div className="space-y-2">
            <p>To install:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Look for the <Download className="inline h-4 w-4 mx-1" /> or <PlusSquare className="inline h-4 w-4 mx-1" /> icon in the address bar.</li>
              <li>Or go to <strong>Settings</strong> <Settings className="inline h-3 w-3 mx-1" /> {'>'} "Install DataCube AU".</li>
              <li>The app will open in a separate window and be added to your desktop/start menu.</li>
            </ol>
          </div>
        ) : (
          <div className="space-y-2">
            <p>Use Chrome or Edge for best experience.</p>
            <ul className="list-disc pl-5">
              <li>Bookmark page for quick access.</li>
              <li>Switch to Chrome for standalone app installation.</li>
            </ul>
          </div>
        )}
      </div>
    );

    if (deviceType === 'ios') return (
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
          <Smartphone className="h-5 w-5 text-primary" />
          <span className="font-semibold">Detected: iPhone / iPad (iOS)</span>
        </div>
        <ol className="pl-5 space-y-1">
          <li>Tap <Share className="inline h-4 w-4 mx-1" /> then "Add to Home Screen".</li>
          <li>Tap "Add" at top-right.</li>
        </ol>
        <p className="text-xs text-muted-foreground">* Only Safari supports this properly.</p>
      </div>
    );

    if (deviceType === 'android' || deviceType === 'tablet') return (
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
          {deviceType === 'tablet' ? <Tablet className="h-5 w-5 text-primary" /> : <Smartphone className="h-5 w-5 text-primary" />}
          <span className="font-semibold">Detected: Android {deviceType === 'tablet' ? 'Tablet' : 'Device'}</span>
        </div>
        <ol className="pl-5 space-y-1">
          <li>Tap <Menu className="inline h-4 w-4 mx-1" /> (three dots).</li>
          <li>Select "Install App" / "Add to Home screen".</li>
          <li>Follow prompts to install.</li>
        </ol>
      </div>
    );

    return <p>Could not detect device. Please check browser settings.</p>;
  }, [browserType, deviceType, isPwaInstalled]);

  const features = useMemo(
    () => [
      {
        icon: FileText,
        title: 'Document Manager',
        description: 'Upload textbooks, attach past questions, and manage document status from one place.',
        bg: 'bg-blue-100',
        fg: 'text-blue-600',
      },
      {
        icon: MessageCircle,
        title: 'AU Chat',
        description: 'Chat with your selected textbook and ask focused questions while studying.',
        bg: 'bg-green-100',
        fg: 'text-green-600',
      },
      {
        icon: Globe,
        title: 'Global Chat',
        description: 'Get platform-wide guidance and navigation help outside a specific document context.',
        bg: 'bg-cyan-100',
        fg: 'text-cyan-600',
      },
      {
        icon: BrainCircuit,
        title: 'Knowledge Hub (Pro)',
        description: 'Generate summaries, key points, topic relationships, and a study roadmap from textbooks.',
        bg: 'bg-orange-100',
        fg: 'text-orange-600',
      },
      {
        icon: ClipboardCheck,
        title: 'Exam Prediction Engine (Pro)',
        description: 'Use textbook plus past-question context to estimate likely exam topics and patterns.',
        bg: 'bg-purple-100',
        fg: 'text-purple-600',
      },
      {
        icon: PenTool,
        title: 'Practice Exam',
        description: 'Create timed practice questions, submit answers, and review score feedback.',
        bg: 'bg-red-100',
        fg: 'text-red-600',
      },
      {
        icon: HelpCircle,
        title: 'Messages & Updates',
        description: 'Read product announcements and open the community update channel.',
        bg: 'bg-emerald-100',
        fg: 'text-emerald-600',
      },
      {
        icon: Settings,
        title: 'Settings & Subscription',
        description: 'Manage profile, app preferences, and plan/billing information.',
        bg: 'bg-slate-100',
        fg: 'text-slate-600',
      },
    ],
    []
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {children
        ? children
        : isControlled
          ? null
          : (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsOpen(true)}>
              <HelpCircle className="h-4 w-4" /> User Guide & Install
            </Button>
          )}

      <DialogContent className="w-[95vw] sm:max-w-[600px] h-[92svh] sm:h-auto sm:max-h-[90svh] flex flex-col overflow-hidden p-4 sm:p-6">
        <Tabs defaultValue="guide" className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="sticky top-0 z-10 shrink-0 bg-background pb-2">
            <DialogHeader>
              <DialogTitle className="font-headline text-2xl flex items-center gap-2">
                <Globe className="h-6 w-6 text-primary" /> DataCube AU User Guide
              </DialogTitle>
              <DialogDescription>Master your study workflow and install the app for the best experience.</DialogDescription>
            </DialogHeader>
            <TabsList className="grid w-full grid-cols-2 mt-3">
              <TabsTrigger value="guide">Site Features</TabsTrigger>
              <TabsTrigger value="install">Install App</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="guide" className="relative mt-4 flex-1 min-h-0 overflow-hidden">
            <ScrollArea className="h-full min-h-0 pr-2 sm:pr-4">
              <div className="space-y-6 pb-8">
                {features.map(f => (
                  <div key={f.title} className="flex flex-col sm:flex-row gap-4">
                    <div className={`h-10 w-10 shrink-0 rounded-lg ${f.bg} flex items-center justify-center ${f.fg}`}>
                      <f.icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base">{f.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{f.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="install" className="mt-4 flex-1 min-h-0 overflow-hidden">
            <ScrollArea className="h-full min-h-0 pr-2 sm:pr-4">{renderInstallInstructions()}</ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4 flex flex-col sm:flex-row gap-2">
          <Button className="w-full sm:w-auto" onClick={() => setIsOpen(false)}>Close Guide</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
