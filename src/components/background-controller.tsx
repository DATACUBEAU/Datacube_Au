'use client';

import { usePathname } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Adaptive3DBackground } from './backgrounds/adaptive-3d-background';

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
    } else if (pathname.includes('/dashboard/chat') || pathname.includes('/dashboard/global-chat')) {
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

  return <Adaptive3DBackground scene={pageType} disableMotion={Boolean(shouldReduceMotion)} />;
}
