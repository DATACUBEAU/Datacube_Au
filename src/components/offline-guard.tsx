'use client';

import React from 'react';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface OfflineGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode; // Optional alternative UI when offline
  disabledReason?: string;
  degradedReason?: string;
  className?: string;
  asChild?: boolean; // If true, clones the child and adds disabled prop
  blockWhenDegraded?: boolean;
}

export function OfflineGuard({ 
  children, 
  fallback, 
  disabledReason = "You are offline. Reconnect to use this feature.",
  degradedReason = "Connection is unstable. Wait for sync to finish before retrying.",
  className,
  asChild = false,
  blockWhenDegraded = false,
}: OfflineGuardProps) {
  const { isOnline, networkState } = useNetworkStatus();
  const { toast } = useToast();
  const blockedByDegraded = blockWhenDegraded && networkState === 'degraded';
  const isBlocked = !isOnline || blockedByDegraded;
  const reason = blockedByDegraded ? degradedReason : disabledReason;

  const handleOfflineClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toast({
      variant: 'destructive',
      title: blockedByDegraded ? "Read-Only Mode" : "Offline Mode",
      description: reason,
      duration: 3000
    });
  };

  if (!isBlocked) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  // If simple wrapper
  if (!asChild) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("opacity-50 cursor-not-allowed relative", className)} onClickCapture={handleOfflineClick}>
               {/* Overlay to intercept clicks on disabled children */}
               <div className="absolute inset-0 z-50" />
               {children}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              {reason}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // If asChild, we try to clone and disable. 
  // NOTE: This only works if the child accepts 'disabled' prop.
  if (React.isValidElement(children)) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("inline-block cursor-not-allowed", className)} onClick={handleOfflineClick}>
               {React.cloneElement(children as React.ReactElement<any>, { 
                 disabled: true,
                 className: cn(children.props.className, "opacity-50 pointer-events-none")
               })}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              {reason}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return null;
}
