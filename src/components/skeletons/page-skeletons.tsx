import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

function HeaderSkeleton({ width = 'w-56' }: { width?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={`h-8 ${width}`} />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

export function SlowNetworkNotice({
  onRetry,
}: {
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-100/40 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>Network is slow. Still trying to load fresh data.</span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <HeaderSkeleton width="w-44" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-5 w-28" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function DocumentsPageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <HeaderSkeleton width="w-52" />
      <Card>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ChatPageSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="border-b p-4 md:px-8">
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex-1 space-y-5 p-4 md:p-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
            <Skeleton className={`h-16 ${index % 2 === 0 ? 'w-3/5' : 'w-2/5'} rounded-2xl`} />
          </div>
        ))}
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-12 w-full rounded-full" />
      </div>
    </div>
  );
}

export function GlobalChatPageSkeleton() {
  return <ChatPageSkeleton />;
}

export function SettingsPageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <HeaderSkeleton width="w-36" />
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BillingPageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <HeaderSkeleton width="w-64" />
      <div className="grid gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AdminPageSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <HeaderSkeleton width="w-72" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-60" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

