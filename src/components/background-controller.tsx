'use client';

import { usePathname } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { AnimatedBackground, type AnimatedBackgroundVariant } from './backgrounds/animated-background';

const DISABLED_PREFIXES = ['/offline'];

type OverrideSettings = {
  disabled: boolean;
  variant?: AnimatedBackgroundVariant;
};

function parseVariant(value: string | null): AnimatedBackgroundVariant | undefined {
  if (value === 'default' || value === 'dashboard' || value === 'auth' || value === 'premium') {
    return value;
  }
  return undefined;
}

export function BackgroundController() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [override, setOverride] = useState<OverrideSettings>({ disabled: false });
  const shouldReduceMotion = useReducedMotion();

  const routeVariant = useMemo<AnimatedBackgroundVariant>(() => {
    if (!pathname) return 'default';
    if (
      pathname === '/login' ||
      pathname.startsWith('/auth') ||
      pathname === '/register' ||
      pathname === '/signup' ||
      pathname.startsWith('/conex')
    ) {
      return 'auth';
    }
    if (pathname.startsWith('/dashboard/settings/subscription')) {
      return 'premium';
    }
    if (pathname.startsWith('/dashboard')) {
      return 'dashboard';
    }
    return 'default';
  }, [pathname]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;

    const readOverrides = () => {
      const body = document.body;
      if (!body) return;
      const disabled = body.getAttribute('data-bg-disabled') === 'true';
      const variant = parseVariant(body.getAttribute('data-bg-variant'));
      setOverride({ disabled, variant });
    };

    readOverrides();

    const observer = new MutationObserver(readOverrides);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-bg-disabled', 'data-bg-variant'],
    });

    return () => {
      observer.disconnect();
    };
  }, [mounted, pathname]);

  // Don't render anything on server to avoid hydration mismatch on initial load, 
  // though for backgrounds it's usually fine, let's be safe.
  if (!mounted) return null;

  const isRouteDisabled = DISABLED_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
  const isDisabled = isRouteDisabled || override.disabled;
  const variant = override.variant || routeVariant;

  return (
    <AnimatedBackground
      variant={variant}
      disabled={isDisabled}
      interactive={variant === 'premium' && !shouldReduceMotion}
      density={variant === 'auth' ? 0.8 : 1}
      opacity={variant === 'auth' ? 0.72 : 0.9}
      speed={variant === 'dashboard' ? 0.18 : undefined}
      blur={variant === 'premium' ? 0.3 : 0.16}
    />
  );
}
