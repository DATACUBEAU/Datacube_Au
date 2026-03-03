'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { areAuthActionsDisabled } from '@/lib/auth/session-expiry-events';

export function SessionDebugPanel() {
  const pathname = usePathname();
  const { authState, runtimeAuthState, isAuthed, isAuthLocked, session } = useSmartAuth();

  const shouldRender = process.env.NODE_ENV === 'development';
  const expiresAtIso = useMemo(() => {
    if (!session?.expires_at) return null;
    const ts = session.expires_at * 1000;
    const date = new Date(ts);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }, [session?.expires_at]);

  if (!shouldRender) return null;

  return (
    <aside className="fixed bottom-3 right-3 z-[9998] w-72 rounded-md border bg-background/95 p-3 text-[11px] shadow-lg">
      <div className="font-semibold">Session Debug</div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <span className="text-muted-foreground">Route</span>
        <span className="truncate">{pathname || '/'}</span>
        <span className="text-muted-foreground">Auth state</span>
        <span>{authState}</span>
        <span className="text-muted-foreground">Runtime</span>
        <span>{runtimeAuthState}</span>
        <span className="text-muted-foreground">Locked</span>
        <span>{String(isAuthLocked)}</span>
        <span className="text-muted-foreground">Authed</span>
        <span>{String(isAuthed)}</span>
        <span className="text-muted-foreground">Disabled key</span>
        <span>{String(areAuthActionsDisabled())}</span>
        <span className="text-muted-foreground">Session exp</span>
        <span className="truncate">{expiresAtIso || 'n/a'}</span>
      </div>
    </aside>
  );
}
