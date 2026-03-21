'use client';

import { useMemo, useState } from 'react';
import { resolveDisplayedPlanCode } from '@/lib/billing/plan-refresh-state';

type HarnessSnapshot = {
  plan: 'free' | 'pro';
  managedPlan: 'free' | 'pro';
  validatedAt: string;
  cachedAt: number | null;
};

type HarnessState = {
  snapshot: HarnessSnapshot | null;
  loading: boolean;
  isUsingCachedData: boolean;
  cachedAt: number | null;
  status: string;
  events: string[];
};

const CACHED_PRO: HarnessSnapshot = {
  plan: 'pro',
  managedPlan: 'pro',
  validatedAt: '2026-03-21T09:15:00.000Z',
  cachedAt: 1769044500000,
};

const SERVER_PRO: HarnessSnapshot = {
  plan: 'pro',
  managedPlan: 'pro',
  validatedAt: '2026-03-21T09:20:00.000Z',
  cachedAt: null,
};

const SERVER_FREE: HarnessSnapshot = {
  plan: 'free',
  managedPlan: 'free',
  validatedAt: '2026-03-21T09:25:00.000Z',
  cachedAt: null,
};

function createInitialState(): HarnessState {
  return {
    snapshot: null,
    loading: false,
    isUsingCachedData: false,
    cachedAt: null,
    status: 'idle',
    events: ['ready'],
  };
}

function cloneSnapshot(snapshot: HarnessSnapshot): HarnessSnapshot {
  return { ...snapshot };
}

export function AccountSnapshotHarness() {
  const [state, setState] = useState<HarnessState>(() => createInitialState());

  const displayedPlan = useMemo(
    () =>
      resolveDisplayedPlanCode({
        snapshot: state.snapshot ? { managedPlan: state.snapshot.managedPlan } : null,
        currentPlanManagedPlan: state.snapshot?.managedPlan || null,
        tier: state.snapshot?.managedPlan || null,
        limitsUsagePlan: state.snapshot?.plan || null,
      }) || 'unknown',
    [state.snapshot],
  );

  const applySnapshot = (snapshot: HarnessSnapshot, options: { fromCache: boolean; label: string }) => {
    setState((current) => ({
      snapshot: cloneSnapshot(snapshot),
      loading: false,
      isUsingCachedData: options.fromCache,
      cachedAt: options.fromCache ? snapshot.cachedAt : Date.now(),
      status: options.label,
      events: [
        ...current.events,
        `${options.fromCache ? 'cached' : 'server'}:${options.label}:${snapshot.plan}:${snapshot.validatedAt}`,
      ],
    }));
  };

  const preserveCurrentSnapshot = (label: string) => {
    setState((current) => ({
      ...current,
      loading: false,
      isUsingCachedData: Boolean(current.snapshot),
      status: label,
      events: [...current.events, `preserved:${label}:${current.snapshot?.plan || 'unknown'}`],
    }));
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Account Snapshot Harness
        </p>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Refresh, offline, and reconnect plan stability</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          These scenarios model the cached server snapshot bootstrap path used for subscription state, so we can
          confirm refreshes and offline mode preserve the last validated plan until the backend explicitly changes it.
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
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">State</p>
          <p data-testid="snapshot-state" className="mt-2 text-lg font-semibold text-foreground">
            {state.status}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Using cache</p>
          <p data-testid="using-cache" className="mt-2 font-mono text-sm text-foreground">
            {String(state.isUsingCachedData)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cached at</p>
          <p data-testid="cached-at" className="mt-2 font-mono text-sm text-foreground">
            {state.cachedAt ? String(state.cachedAt) : 'none'}
          </p>
        </div>
      </section>

      <section className="grid gap-3 rounded-3xl border border-border bg-card p-6 shadow-sm sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          data-testid="scenario-refresh-pro"
          onClick={() => applySnapshot(CACHED_PRO, { fromCache: true, label: 'refresh-from-cache' })}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Refresh keeps cached Pro
        </button>
        <button
          type="button"
          data-testid="scenario-offline-pro"
          onClick={() => applySnapshot(CACHED_PRO, { fromCache: true, label: 'offline-cached-pro' })}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Offline keeps cached Pro
        </button>
        <button
          type="button"
          data-testid="scenario-reconnect-success"
          onClick={() => {
            applySnapshot(CACHED_PRO, { fromCache: true, label: 'seed-cached-pro' });
            window.setTimeout(() => applySnapshot(SERVER_PRO, { fromCache: false, label: 'revalidated-pro' }), 40);
          }}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Reconnect revalidates Pro
        </button>
        <button
          type="button"
          data-testid="scenario-backend-downgrade"
          onClick={() => {
            applySnapshot(CACHED_PRO, { fromCache: true, label: 'seed-cached-pro' });
            window.setTimeout(() => applySnapshot(SERVER_FREE, { fromCache: false, label: 'backend-downgrade' }), 40);
          }}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Backend downgrade to Free
        </button>
        <button
          type="button"
          data-testid="scenario-fetch-failure"
          onClick={() => {
            applySnapshot(CACHED_PRO, { fromCache: true, label: 'seed-cached-pro' });
            window.setTimeout(() => preserveCurrentSnapshot('fetch-failure-preserved'), 40);
          }}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Fetch failure keeps Pro
        </button>
        <button
          type="button"
          data-testid="scenario-cache-miss"
          onClick={() => setState({
            snapshot: null,
            loading: false,
            isUsingCachedData: false,
            cachedAt: null,
            status: 'cache-miss',
            events: [...state.events, 'cache-miss:unknown'],
          })}
          className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Cache miss stays unknown
        </button>
      </section>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Event log</p>
        <pre
          data-testid="event-log"
          className="mt-4 overflow-x-auto rounded-2xl bg-muted/40 p-4 text-xs text-foreground"
        >
          {state.events.join('\n')}
        </pre>
      </section>
    </main>
  );
}
