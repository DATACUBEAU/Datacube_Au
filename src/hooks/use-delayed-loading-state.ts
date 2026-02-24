'use client';

import { useEffect, useState } from 'react';

type Options = {
  showAfterMs?: number;
  slowAfterMs?: number;
};

export function useDelayedLoadingState(isLoading: boolean, options: Options = {}) {
  const showAfterMs = options.showAfterMs ?? 200;
  const slowAfterMs = options.slowAfterMs ?? 8000;

  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showSlowNotice, setShowSlowNotice] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false);
      setShowSlowNotice(false);
      return;
    }

    const skeletonTimer = window.setTimeout(() => {
      setShowSkeleton(true);
    }, showAfterMs);

    const slowTimer = window.setTimeout(() => {
      setShowSlowNotice(true);
    }, slowAfterMs);

    return () => {
      window.clearTimeout(skeletonTimer);
      window.clearTimeout(slowTimer);
    };
  }, [isLoading, showAfterMs, slowAfterMs]);

  return {
    showSkeleton,
    showSlowNotice,
  };
}

