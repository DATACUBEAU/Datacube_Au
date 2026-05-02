'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WifiOff, RefreshCw, Home, Cloud, CloudOff, Clock, CheckCircle2, AlertTriangle, FileText, MessageCircle, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

type CachedRoute = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const KNOWN_ROUTES: CachedRoute[] = [
  { path: '/dashboard', label: 'Dashboard', icon: Home },
  { path: '/dashboard/documents', label: 'Documents', icon: FileText },
  { path: '/dashboard/chat', label: 'AU Chat', icon: MessageCircle },
  { path: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function OfflinePage() {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [cachedRoutes, setCachedRoutes] = useState<string[]>([]);

  useEffect(() => {
    // Load offline queue stats
    void (async () => {
      try {
        const { getPendingCount, getFailedCount } = await import('@/lib/offline/write-queue');
        const { getSyncStatus } = await import('@/lib/offline/sync-engine');
        const [pending, failed, status] = await Promise.all([
          getPendingCount(),
          getFailedCount(),
          Promise.resolve(getSyncStatus()),
        ]);
        setPendingCount(pending);
        setFailedCount(failed);
        setLastSyncedAt(status.lastSyncedAt);
      } catch {
        // Modules may not be available if SW hasn't loaded yet
      }
    })();

    // Check which routes are available in cache
    void (async () => {
      if (!('caches' in window)) return;
      try {
        const cacheNames = await caches.keys();
        const available: string[] = [];
        for (const route of KNOWN_ROUTES) {
          for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const match = await cache.match(route.path);
            if (match) {
              available.push(route.path);
              break;
            }
          }
        }
        setCachedRoutes(available);
      } catch {
        // Cache API may not be available
      }
    })();
  }, []);

  const handleRefresh = () => {
    window.location.reload();
  };

  const totalQueued = pendingCount + failedCount;

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-background">
      <div className="max-w-lg w-full space-y-4">
        {/* Main Card */}
        <Card className="border-2 border-muted shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mb-4">
              <WifiOff className="w-8 h-8 text-amber-500" />
            </div>
            <CardTitle className="text-2xl font-headline">You are Offline</CardTitle>
            <CardDescription>
              It looks like you&apos;ve lost your internet connection.
              {totalQueued > 0 && ' Don\u2019t worry \u2014 your pending actions are saved and will sync when you reconnect.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              You can still browse pages you&apos;ve visited recently. All your data is cached locally.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button onClick={handleRefresh} className="flex-1">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Reconnecting
              </Button>
              <Button variant="outline" onClick={() => router.push('/dashboard')} className="flex-1">
                <Home className="mr-2 h-4 w-4" />
                Go to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sync Status Card */}
        {totalQueued > 0 && (
          <Card className="border border-amber-500/20 bg-amber-500/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-amber-500/10">
                  <Cloud className="h-5 w-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {pendingCount > 0 && `${pendingCount} pending action${pendingCount > 1 ? 's' : ''}`}
                    {pendingCount > 0 && failedCount > 0 && ' · '}
                    {failedCount > 0 && (
                      <span className="text-red-400">{failedCount} failed</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lastSyncedAt
                      ? `Last synced: ${new Date(lastSyncedAt).toLocaleTimeString()}`
                      : 'Will sync when connection is restored'}
                  </p>
                </div>
                {failedCount > 0 ? (
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                ) : (
                  <Clock className="h-5 w-5 text-amber-400" />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Available Cached Routes */}
        {cachedRoutes.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Available Offline
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-2 gap-2">
                {KNOWN_ROUTES.filter((r) => cachedRoutes.includes(r.path)).map((route) => (
                  <Button
                    key={route.path}
                    variant="outline"
                    size="sm"
                    className="justify-start h-9"
                    onClick={() => router.push(route.path)}
                  >
                    <route.icon className="mr-2 h-3.5 w-3.5" />
                    {route.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Unavailable Routes */}
        {cachedRoutes.length > 0 && KNOWN_ROUTES.filter((r) => !cachedRoutes.includes(r.path)).length > 0 && (
          <Card className="opacity-60">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CloudOff className="h-4 w-4 text-muted-foreground" />
                Requires Internet
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-2 gap-2">
                {KNOWN_ROUTES.filter((r) => !cachedRoutes.includes(r.path)).map((route) => (
                  <div
                    key={route.path}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md border border-dashed"
                  >
                    <route.icon className="h-3.5 w-3.5" />
                    {route.label}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
