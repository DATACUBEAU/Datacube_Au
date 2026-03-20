'use client';

import { useMemo, useRef, useState } from 'react';
import {
  resolveDisplayedPlanCode,
  shouldApplyBillingStatusResponse,
} from '@/lib/billing/plan-refresh-state';

type HarnessSnapshot = {
  checksum: string;
  issuedAt: string;
  managedPlan: 'free' | 'pro';
  activePlanKey: 'pro_monthly' | 'pro_weekly' | null;
};

type HarnessStatus = {
  tier: 'free' | 'pro';
  currentPlanManagedPlan: 'free' | 'pro';
  planSnapshot: HarnessSnapshot;
};

const FREE_STATUS: HarnessStatus = {
  tier: 'free',
  currentPlanManagedPlan: 'free',
  planSnapshot: {
    checksum: 'plan:free:v1',
    issuedAt: '2026-03-20T09:00:00.000Z',
    managedPlan: 'free',
    activePlanKey: null,
  },
};

const PRO_MONTHLY_STATUS: HarnessStatus = {
  tier: 'pro',
  currentPlanManagedPlan: 'pro',
  planSnapshot: {
    checksum: 'plan:pro-monthly:v2',
    issuedAt: '2026-03-20T09:05:00.000Z',
    managedPlan: 'pro',
    activePlanKey: 'pro_monthly',
  },
};

const PRO_WEEKLY_STATUS: HarnessStatus = {
  tier: 'pro',
  currentPlanManagedPlan: 'pro',
  planSnapshot: {
    checksum: 'plan:pro-weekly:v3',
    issuedAt: '2026-03-20T09:06:00.000Z',
    managedPlan: 'pro',
    activePlanKey: 'pro_weekly',
  },
};

const FINAL_FAILURE_STATUS: HarnessStatus = {
  tier: 'free',
  currentPlanManagedPlan: 'free',
  planSnapshot: {
    checksum: 'plan:free:final-failure:v4',
    issuedAt: '2026-03-20T09:07:00.000Z',
    managedPlan: 'free',
    activePlanKey: null,
  },
};

function cloneStatus(status: HarnessStatus): HarnessStatus {
  return {
    tier: status.tier,
    currentPlanManagedPlan: status.currentPlanManagedPlan,
    planSnapshot: { ...status.planSnapshot },
  };
}

export function BillingRefreshHarness() {
  const [status, setStatus] = useState<HarnessStatus>(() => cloneStatus(FREE_STATUS));
  const [scenario, setScenario] = useState('idle');
  const [events, setEvents] = useState<string[]>(['ready']);
  const activeRequestIdRef = useRef(0);
  const latestAppliedIssuedAtRef = useRef<string | null>(FREE_STATUS.planSnapshot.issuedAt);

  const displayedPlan = useMemo(
    () =>
      resolveDisplayedPlanCode({
        snapshot: status.planSnapshot,
        currentPlanManagedPlan: status.currentPlanManagedPlan,
        tier: status.tier,
        limitsUsagePlan: null,
      }),
    [status],
  );

  const recordEvent = (message: string) => {
    setEvents((current) => [...current, message]);
  };

  const applyResponse = (requestId: number, nextStatus: HarnessStatus, label: string) => {
    const allowed = shouldApplyBillingStatusResponse({
      requestId,
      activeRequestId: activeRequestIdRef.current,
      currentIssuedAt: latestAppliedIssuedAtRef.current,
      nextIssuedAt: nextStatus.planSnapshot.issuedAt,
    });

    recordEvent(`${allowed ? 'applied' : 'ignored'}:${label}:${requestId}:${nextStatus.planSnapshot.checksum}`);
    if (!allowed) {
      return false;
    }

    latestAppliedIssuedAtRef.current = nextStatus.planSnapshot.issuedAt;
    setStatus(cloneStatus(nextStatus));
    return true;
  };

  const resetHarness = () => {
    activeRequestIdRef.current = 0;
    latestAppliedIssuedAtRef.current = FREE_STATUS.planSnapshot.issuedAt;
    setStatus(cloneStatus(FREE_STATUS));
    setScenario('reset');
    setEvents(['ready', 'reset']);
  };

  const runSuccessfulRenewal = () => {
    const requestId = ++activeRequestIdRef.current;
    setScenario('successful-renewal');
    applyResponse(requestId, PRO_MONTHLY_STATUS, 'renewal-success');
  };

  const runHardDecline = () => {
    const seedRequestId = ++activeRequestIdRef.current;
    applyResponse(seedRequestId, PRO_MONTHLY_STATUS, 'seed-pro');

    const failureRequestId = ++activeRequestIdRef.current;
    setScenario('hard-decline');
    applyResponse(failureRequestId, FINAL_FAILURE_STATUS, 'final-failure');
  };

  const runTimeout = () => {
    const seedRequestId = ++activeRequestIdRef.current;
    applyResponse(seedRequestId, PRO_MONTHLY_STATUS, 'seed-pro');

    const timeoutRequestId = ++activeRequestIdRef.current;
    setScenario('network-timeout');
    recordEvent(`timeout:status:${timeoutRequestId}`);
  };

  const runConcurrentRefresh = async () => {
    const staleRequestId = ++activeRequestIdRef.current;
    const authoritativeRequestId = ++activeRequestIdRef.current;

    setScenario('concurrent-refresh');
    applyResponse(authoritativeRequestId, PRO_WEEKLY_STATUS, 'authoritative-refresh');
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    applyResponse(staleRequestId, FREE_STATUS, 'stale-refresh');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Billing Refresh Harness
        </p>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Plan stability scenarios</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          This non-production page exercises the same stale-response guards the subscription page uses so the browser
          keeps the latest authoritative plan when renewals, failures, timeouts, and overlapping refreshes happen.
        </p>
      </section>

      <section className="grid gap-4 rounded-3xl border border-border bg-card p-6 shadow-sm md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Displayed plan</p>
          <p data-testid="displayed-plan" className="mt-2 text-3xl font-bold text-foreground">
            {displayedPlan}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Scenario</p>
          <p data-testid="scenario-name" className="mt-2 text-lg font-semibold text-foreground">
            {scenario}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Checksum</p>
          <p data-testid="plan-checksum" className="mt-2 font-mono text-sm text-foreground">
            {status.planSnapshot.checksum}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active plan key</p>
          <p data-testid="active-plan-key" className="mt-2 font-mono text-sm text-foreground">
            {status.planSnapshot.activePlanKey || 'free'}
          </p>
        </div>
      </section>

      <section className="grid gap-3 rounded-3xl border border-border bg-card p-6 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
        <button
          type="button"
          data-testid="scenario-successful-renewal"
          onClick={runSuccessfulRenewal}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Successful renewal
        </button>
        <button
          type="button"
          data-testid="scenario-hard-decline"
          onClick={runHardDecline}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Hard decline
        </button>
        <button
          type="button"
          data-testid="scenario-network-timeout"
          onClick={runTimeout}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Network timeout
        </button>
        <button
          type="button"
          data-testid="scenario-concurrent-refresh"
          onClick={() => void runConcurrentRefresh()}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Concurrent refresh
        </button>
        <button
          type="button"
          data-testid="scenario-reset"
          onClick={resetHarness}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Reset
        </button>
      </section>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Event log</p>
        <pre
          data-testid="event-log"
          className="mt-4 overflow-x-auto rounded-2xl bg-muted/40 p-4 text-xs text-foreground"
        >
          {events.join('\n')}
        </pre>
      </section>
    </main>
  );
}
