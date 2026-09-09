'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Gauge,
  HardDrive,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLimits } from '@/components/providers/limits-provider';
import { buildSubscriptionUsageRows } from '@/lib/billing/subscription-page-state';
import { cn } from '@/lib/utils';

const ICONS: Record<string, typeof MessageSquare> = {
  max_chats_total: MessageSquare,
  max_uploads_total: FileUp,
  max_tokens_total: Zap,
  max_file_size_mb: HardDrive,
  max_concurrent_jobs: Gauge,
  max_exam_predictions: Sparkles,
  max_practice_exams: Sparkles,
  max_knowledge_hub: Sparkles,
};

type UsageDisplayRow = {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  resetText: string;
  mode: string;
  enabled: boolean;
};

function number(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Math.max(0, value));
}

function statusFor(used: number, limit: number | null, enabled: boolean) {
  if (!enabled) return { percent: 0, label: 'Disabled', level: 'disabled' as const };
  if (limit === null) return { percent: 0, label: 'Unlimited', level: 'normal' as const };
  if (limit <= 0) return { percent: 100, label: 'Limit reached', level: 'blocked' as const };

  const normalizedUsed = Math.max(0, used);
  const blocked = normalizedUsed >= limit;
  const percent = Math.min(100, Math.round((normalizedUsed / limit) * 100));
  if (blocked) return { percent, label: 'Limit reached', level: 'blocked' as const };
  if (percent >= 90) return { percent, label: 'Almost full', level: 'danger' as const };
  if (percent >= 75) return { percent, label: 'Approaching limit', level: 'warning' as const };
  return { percent, label: 'Available', level: 'normal' as const };
}

function UsageCard({ row }: { row: UsageDisplayRow }) {
  const Icon = ICONS[row.key] || Gauge;
  const status = statusFor(row.used, row.limit, row.enabled);
  const remaining = row.limit === null ? null : Math.max(0, row.limit - row.used);

  return (
    <Card className={cn(
      'overflow-hidden shadow-sm',
      status.level === 'blocked' && 'border-destructive/50',
      status.level === 'danger' && 'border-orange-500/50',
      status.level === 'warning' && 'border-amber-500/40',
      status.level === 'disabled' && 'border-muted bg-muted/20',
    )}>
      <CardContent className="p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{row.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {!row.enabled ? 'Not included in your current plan' : row.limit === null ? 'No usage cap' : `${number(remaining || 0)} remaining`}
              </p>
            </div>
          </div>
          <Badge variant={status.level === 'blocked' ? 'destructive' : 'secondary'} className="shrink-0">
            {status.label}
          </Badge>
        </div>

        {!row.enabled ? (
          <p className="text-sm text-muted-foreground">This feature is currently unavailable on your plan.</p>
        ) : (
          <>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <span className="text-2xl font-bold tabular-nums">{number(row.used)}</span>
                <span className="text-sm text-muted-foreground">{row.limit === null ? ' used' : ` / ${number(row.limit)}`}</span>
              </div>
              {row.limit !== null ? <span className="text-sm font-medium tabular-nums">{status.percent}%</span> : null}
            </div>

            {row.limit !== null ? (
              <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-label={`${row.label}: ${status.percent}% used`}>
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-300',
                    status.level === 'blocked' ? 'bg-destructive' :
                      status.level === 'danger' ? 'bg-orange-500' :
                        status.level === 'warning' ? 'bg-amber-500' : 'bg-primary',
                  )}
                  style={{ width: `${status.percent}%` }}
                />
              </div>
            ) : (
              <div className="flex h-2.5 items-center overflow-hidden rounded-full bg-primary/15">
                <div className="h-full w-full bg-primary/40" />
              </div>
            )}

            {row.resetText ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{row.resetText}</p> : null}
          </>
        )}

        {status.level === 'blocked' || status.level === 'disabled' ? (
          <Button asChild size="sm" className="mt-4 w-full">
            <Link href="/dashboard/settings/subscription">View plan options</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CapacityRow({ row }: { row: UsageDisplayRow }) {
  const Icon = ICONS[row.key] || Gauge;
  const remaining = row.limit === null ? null : Math.max(0, row.limit - row.used);
  let description = row.resetText || 'This is a plan capacity limit.';

  if (!row.enabled) {
    description = 'This feature is currently unavailable on your plan.';
  } else if (row.mode === 'concurrency') {
    description = row.limit === null
      ? 'Unlimited simultaneous processing'
      : `${number(Math.min(row.used, row.limit))} active · ${number(remaining || 0)} processing slots available`;
  } else if (row.mode === 'per_request') {
    description = row.limit === null ? 'No per-request cap' : `Up to ${number(row.limit)} per request`;
  } else if (row.mode === 'current') {
    description = row.limit === null
      ? `${number(row.used)} currently stored · no cap`
      : `${number(row.used)} currently stored · ${number(remaining || 0)} available`;
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-medium">{row.label}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Badge variant="outline" className="w-fit">{row.enabled ? 'Plan capacity' : 'Disabled'}</Badge>
    </div>
  );
}

export default function UsagePage() {
  const { usage, refreshUsage } = useLimits();
  const [refreshing, setRefreshing] = useState(false);

  const view = useMemo(() => buildSubscriptionUsageRows({
    currentPlanManagedPlan: typeof usage.plan === 'string' ? usage.plan : null,
    tier: typeof usage.plan === 'string' ? usage.plan : null,
    usage: {
      plan: typeof usage.plan === 'string' ? usage.plan : null,
      limits: (usage.limits || {}) as Record<string, number>,
      limitRules: (usage.limitRules || {}) as Record<string, Record<string, unknown>>,
      usageByLimit: (usage.usageByLimit || {}) as Record<string, Record<string, unknown>>,
    },
  }), [usage.limitRules, usage.limits, usage.plan, usage.usageByLimit]);

  const rows = useMemo<UsageDisplayRow[]>(() => view.rows.map((row) => {
    const rule = usage.limitRules?.[row.key] as Record<string, unknown> | undefined;
    return {
      ...row,
      mode: String(rule?.mode || 'usage').trim().toLowerCase(),
      enabled: rule?.is_enabled !== false,
    };
  }), [usage.limitRules, view.rows]);

  const usageRows = rows.filter((row) => row.mode === 'usage');
  const capacityRows = rows.filter((row) => row.mode !== 'usage');
  const limitedRows = usageRows.filter((row) => row.enabled && row.limit !== null);
  const totalPercent = limitedRows.length > 0
    ? Math.round(limitedRows.reduce((sum, row) => {
      if ((row.limit || 0) <= 0) return sum + 100;
      return sum + Math.min(100, (row.used / (row.limit || 1)) * 100);
    }, 0) / limitedRows.length)
    : 0;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshUsage();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link href="/dashboard/settings/subscription"><ArrowLeft className="mr-2 h-4 w-4" />Subscription</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Usage</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            See what your plan includes, what you have used, and when each allowance resets.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onRefresh} disabled={refreshing || usage.loading}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background">
        <CardContent className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{view.planCode ? view.planCode.toUpperCase() : 'PLAN'}</Badge>
              <Badge variant="outline"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Active</Badge>
            </div>
            <h2 className="text-xl font-semibold">Your plan allowances</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Using an allowance does not cancel your subscription. Only the affected feature pauses when its limit is reached.
            </p>
            {view.resetSummary.length > 0 ? (
              <p className="mt-3 text-xs font-medium text-muted-foreground">{view.resetSummary.join(' · ')}</p>
            ) : null}
          </div>
          <div className="rounded-2xl border bg-background/80 px-5 py-4 text-center shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Average allowance used</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{totalPercent}%</p>
          </div>
        </CardContent>
      </Card>

      {usage.loading && rows.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading usage…
        </div>
      ) : !view.hasData ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <TriangleAlert className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Usage is not available yet</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">Refresh the page or try again after your account limits finish loading.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {usageRows.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Usage allowances</h2>
                <p className="text-sm text-muted-foreground">These are consumed as you use AI and generation features.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {usageRows.map((row) => <UsageCard key={row.key} row={row} />)}
              </div>
            </section>
          ) : null}

          {capacityRows.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Plan capacity</h2>
                <p className="text-sm text-muted-foreground">These are live operating limits, not allowances that get used up.</p>
              </div>
              <Card>
                <CardContent className="space-y-3 p-4 sm:p-5">
                  {capacityRows.map((row) => <CapacityRow key={row.key} row={row} />)}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Need more usage?</p>
          <p className="text-muted-foreground">Review your plan without losing your existing documents or chats.</p>
        </div>
        <Button asChild variant="outline"><Link href="/dashboard/settings/subscription">Manage subscription</Link></Button>
      </div>
    </div>
  );
}