'use client';

import Link from 'next/link';
import { AlertTriangle, Crown, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type FeatureGatePanelProps = {
  title: string;
  description: string;
  mode: 'upgrade' | 'disabled';
  onPrimaryAction?: () => void;
  primaryLabel?: string;
};

export function FeatureGatePanel({
  title,
  description,
  mode,
  onPrimaryAction,
  primaryLabel,
}: FeatureGatePanelProps) {
  const Icon = mode === 'upgrade' ? Crown : AlertTriangle;

  return (
    <main className="flex flex-1 items-center justify-center p-4 md:p-8">
      <Card className="w-full max-w-2xl border-primary/15 bg-card/95 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription className="text-sm">{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          {mode === 'upgrade' ? (
            <Button onClick={onPrimaryAction}>
              <Lock className="mr-2 h-4 w-4" />
              {primaryLabel || 'Upgrade to Pro'}
            </Button>
          ) : (
            <Button asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href="/dashboard/settings/subscription">View Plan Limits</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
