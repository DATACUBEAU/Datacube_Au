'use client';

import { useEffect } from 'react';
import type { AnimatedBackgroundVariant } from '@/components/backgrounds/animated-background';

type BackgroundOverrideOptions = {
  variant?: AnimatedBackgroundVariant;
  disabled?: boolean;
};

export function useBackgroundOverride(options: BackgroundOverrideOptions) {
  const { variant, disabled } = options;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const previousVariant = body.getAttribute('data-bg-variant');
    const previousDisabled = body.getAttribute('data-bg-disabled');

    if (variant) {
      body.setAttribute('data-bg-variant', variant);
    } else {
      body.removeAttribute('data-bg-variant');
    }

    if (disabled === true) {
      body.setAttribute('data-bg-disabled', 'true');
    } else {
      body.removeAttribute('data-bg-disabled');
    }

    return () => {
      if (previousVariant !== null) {
        body.setAttribute('data-bg-variant', previousVariant);
      } else {
        body.removeAttribute('data-bg-variant');
      }

      if (previousDisabled !== null) {
        body.setAttribute('data-bg-disabled', previousDisabled);
      } else {
        body.removeAttribute('data-bg-disabled');
      }
    };
  }, [disabled, variant]);
}
