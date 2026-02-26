'use client';

import React from 'react';
import { useFlag } from '@/components/feature-flag-provider';

type FeatureGateProps = {
  flag: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

export function FeatureGate({ flag, fallback = null, children }: FeatureGateProps) {
  const { enabled, loading } = useFlag(flag);
  if (loading) return null;
  if (!enabled) return <>{fallback}</>;
  return <>{children}</>;
}
