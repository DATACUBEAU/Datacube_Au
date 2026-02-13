'use client';

import { usePathname } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { MarketingBackground } from './backgrounds/marketing-background';
import { InformationalBackground } from './backgrounds/informational-background';
import { SystemBackground } from './backgrounds/system-background';
import { ProductivityBackground } from './backgrounds/productivity-background';
import { FocusBackground } from './backgrounds/focus-background';

type PageType = 'marketing' | 'informational' | 'system' | 'productivity' | 'focus';

export function BackgroundController() {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const [pageType, setPageType] = useState<PageType>('marketing');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!pathname) return;

    // Route Classification Logic
    if (pathname === '/' || pathname === '/features') {
      setPageType('marketing');
    } else if (pathname === '/about') {
      setPageType('informational');
    } else if (pathname === '/login' || pathname === '/policy' || pathname === '/terms' || pathname.includes('/settings')) {
      setPageType('system');
    } else if (pathname.includes('/dashboard/chat')) {
      setPageType('focus');
    } else if (pathname.startsWith('/dashboard')) {
      // Default dashboard pages (documents, knowledge, etc.)
      setPageType('productivity');
    } else {
      // Fallback for unknown routes
      setPageType('informational');
    }
  }, [pathname]);

  // Don't render anything on server to avoid hydration mismatch on initial load, 
  // though for backgrounds it's usually fine, let's be safe.
  if (!mounted) return null;

  // Global Reduced Motion Override
  if (shouldReduceMotion) {
    return <SystemBackground />;
  }

  // Render appropriate background
  switch (pageType) {
    case 'marketing':
      return <MarketingBackground />;
    case 'informational':
      return <InformationalBackground />;
    case 'system':
      return <SystemBackground />;
    case 'productivity':
      return <ProductivityBackground />;
    case 'focus':
      return <FocusBackground />;
    default:
      return <SystemBackground />;
  }
}
