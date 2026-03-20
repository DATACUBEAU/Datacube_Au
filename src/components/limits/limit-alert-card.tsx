'use client';

import Link from 'next/link';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { LimitAlert } from '@/lib/limits/limitations-agent';

type LimitAlertCardProps = {
  alert: LimitAlert;
  onDismiss?: (alertId: string) => void;
};

function iconForSeverity(severity: LimitAlert['severity']) {
  if (severity === 'block') return <ShieldAlert className="h-4 w-4 text-destructive" />;
  if (severity === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
}

export function LimitAlertCard({ alert, onDismiss }: LimitAlertCardProps) {
  return (
    <Card className={alert.severity === 'block' ? 'border-destructive/50' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          {iconForSeverity(alert.severity)}
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{alert.title}</span>
        </CardTitle>
        <CardDescription className="break-words [overflow-wrap:anywhere]">{alert.message}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {alert.suggestions.length > 0 ? (
          <div className="text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">
            {alert.suggestions[0]}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {alert.cta ? (
            <Button size="sm" asChild>
              <Link href={alert.cta.href}>{alert.cta.label}</Link>
            </Button>
          ) : null}
          {alert.dismissible && onDismiss ? (
            <Button size="sm" variant="outline" onClick={() => onDismiss(alert.id)}>
              Dismiss
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
