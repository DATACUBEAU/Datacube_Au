'use client';
import React from 'react';
import { useState, useEffect, useRef } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter,
  DialogTrigger
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Laptop, 
  Smartphone, 
  Tablet, 
  Chrome, 
  Globe, 
  Share, 
  PlusSquare, 
  Menu, 
  Download, 
  HelpCircle, 
  BookOpen, 
  MessageCircle, 
  BrainCircuit, 
  ClipboardCheck, 
  FileText, 
  Monitor, 
  PenTool, 
  Highlighter, 
  ChevronDown, 
  Settings
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

import { updateUserActivity, fetchUserMetadata } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';

export function SiteManualGuide() {
  const [user] = useSupabaseUser();
  const [isOpen, setIsOpen] = useState(false);
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
    const checkGuide = async () => {
      const metadata = await fetchUserMetadata(user);
      const hasSeenGuide = metadata.hasSeenGuide;
      if (!hasSeenGuide && !window.matchMedia('(display-mode: standalone)').matches) {
        setIsOpen(true);
        updateUserActivity(user, { hasSeenGuide: true });
      }
    };
    
    checkGuide();
  }, [user]);

  const renderInstallInstructions = () => {
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
  };

  const features = [
    { icon: FileText, title: 'Documents', description: 'Upload textbooks or notes, AU analyzes them and creates summaries.', bg: 'bg-blue-100', fg: 'text-blue-600' },
    { icon: MessageCircle, title: 'AU Chat', description: 'Ask specific questions. AU cites exact pages.', bg: 'bg-green-100', fg: 'text-green-600' },
    { icon: ClipboardCheck, title: 'Predictions', description: 'AU predicts likely exam questions based on your documents.', bg: 'bg-purple-100', fg: 'text-purple-600' },
    { icon: BrainCircuit, title: 'Knowledge Graph', description: 'Visualize concept connections interactively.', bg: 'bg-orange-100', fg: 'text-orange-600' },
    { icon: PenTool, title: 'Practice Exam', description: 'Test your knowledge with realistic practice exams.', bg: 'bg-red-100', fg: 'text-red-600' },
    { icon: Globe, title: 'AU Global', description: 'Enable Browser Mode to let AU search the web for real-time answers outside your documents.', bg: 'bg-cyan-100', fg: 'text-cyan-600' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <HelpCircle className="h-4 w-4" /> User Guide & Install
        </Button>
      </DialogTrigger>

      <DialogContent className="w-[95vw] sm:max-w-[600px] max-h-[90svh] flex flex-col p-4 sm:p-6">
        <Tabs defaultValue="guide" className="flex-1 flex flex-col overflow-hidden">
          <div className="sticky top-0 bg-background z-10 pb-2">
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

          <TabsContent value="guide" className="flex-1 relative mt-4 overflow-hidden">
            <ScrollArea className="h-full pr-2 sm:pr-4">
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

          <TabsContent value="install" className="flex-1 mt-4 overflow-hidden">
            <ScrollArea className="h-full pr-2 sm:pr-4">{renderInstallInstructions()}</ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4 flex flex-col sm:flex-row gap-2">
          <Button className="w-full sm:w-auto" onClick={() => setIsOpen(false)}>Close Guide</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}