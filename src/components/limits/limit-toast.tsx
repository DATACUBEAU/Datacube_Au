'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import type { LimitAlert } from '@/lib/limits/limitations-agent';

type LimitToastProps = {
  alert: LimitAlert | null;
  onShown?: (alert: LimitAlert) => void;
};

export function LimitToast({ alert, onShown }: LimitToastProps) {
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!alert) return;
    toast({
      variant: alert.severity === 'block' ? 'destructive' : 'default',
      title: alert.title,
      description: alert.message,
      action: alert.cta
        ? (
          <ToastAction altText={alert.cta.label} onClick={() => router.push(alert.cta!.href)}>
            {alert.cta.label}
          </ToastAction>
        )
        : undefined,
      duration: alert.severity === 'block' ? 8000 : 5000,
    });
    onShown?.(alert);
  }, [alert, onShown, router, toast]);

  return null;
}
