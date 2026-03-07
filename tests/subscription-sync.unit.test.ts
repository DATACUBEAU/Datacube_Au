import assert from 'node:assert/strict';
import {
  FREE_PLAN_EXPIRATION_DAYS,
  PAID_PRO_PLAN_EXPIRATION_DAYS,
  computeUtcQuotaWindowBounds,
  formatExpirationWindowLabel,
  prorateExpirationTimestamp,
  resolvePlanExpirationDays,
} from '../src/lib/plans/subscription-policy.js';
import { applyPlanTransition } from '../src/lib/server/plan-sync.js';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

async function run(name: string, fn: AsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

class FakeTable {
  constructor(
    private readonly supabase: FakeSupabase,
    private readonly table: string,
  ) {}

  async upsert(payload: Record<string, unknown>) {
    if (this.table === 'au_user_entitlements' || this.table === 'au_user_profiles' || this.table === 'billing_subscriptions') {
      this.supabase.maps[this.table].set(String(payload.user_id || ''), payload);
      return { data: payload, error: null };
    }
    throw new Error(`Unsupported upsert table: ${this.table}`);
  }

  async insert(payload: Record<string, unknown>) {
    if (this.table === 'entitlement_audit') {
      this.supabase.auditRows.push(payload);
      return { data: payload, error: null };
    }
    throw new Error(`Unsupported insert table: ${this.table}`);
  }
}

class FakeSupabase {
  mode: 'missing' | 'success' = 'missing';
  delayMs = 0;
  concurrentRpcs = 0;
  maxConcurrentRpcs = 0;
  rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  maps = {
    au_user_entitlements: new Map<string, Record<string, unknown>>(),
    au_user_profiles: new Map<string, Record<string, unknown>>(),
    billing_subscriptions: new Map<string, Record<string, unknown>>(),
  };
  auditRows: Record<string, unknown>[] = [];

  from(table: string) {
    return new FakeTable(this, table);
  }

  async rpc(name: string, payload: Record<string, unknown>) {
    this.rpcCalls.push({ name, payload });

    if (this.mode === 'missing') {
      return {
        data: null,
        error: {
          code: '42883',
          message: 'function does not exist',
        },
      };
    }

    this.concurrentRpcs += 1;
    this.maxConcurrentRpcs = Math.max(this.maxConcurrentRpcs, this.concurrentRpcs);

    await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    this.concurrentRpcs -= 1;

    return {
      data: {
        changed: true,
        previous_plan: 'free',
        previous_entitlement_source: 'none',
        plan: payload.p_target_plan,
        entitlement_source: payload.p_entitlement_source,
        expires_at: payload.p_entitlement_expires_at ?? null,
        documents_updated: 2,
        trace_id: payload.p_trace_id,
      },
      error: null,
    };
  }
}

async function main() {
  await run('daily quota windows reset exactly at 00:00 UTC', () => {
    const beforeMidnight = computeUtcQuotaWindowBounds(1, new Date('2026-03-07T23:59:59.000Z'));
    const afterMidnight = computeUtcQuotaWindowBounds(1, new Date('2026-03-08T00:00:00.000Z'));

    assert.equal(beforeMidnight.start, '2026-03-07T00:00:00.000Z');
    assert.equal(beforeMidnight.end, '2026-03-08T00:00:00.000Z');
    assert.equal(afterMidnight.start, '2026-03-08T00:00:00.000Z');
    assert.equal(afterMidnight.end, '2026-03-09T00:00:00.000Z');
  });

  await run('non-resetting quotas stay on the lifetime window', () => {
    const lifetimeWindow = computeUtcQuotaWindowBounds(0, new Date('2026-03-07T12:00:00.000Z'));
    assert.equal(lifetimeWindow.start, '1970-01-01T00:00:00.000Z');
    assert.equal(lifetimeWindow.end, null);
  });

  await run('expiration policy keeps promo at 14 days and paid Pro at 30 days', () => {
    assert.equal(resolvePlanExpirationDays({ plan: 'free', entitlementSource: 'none' }), FREE_PLAN_EXPIRATION_DAYS);
    assert.equal(resolvePlanExpirationDays({ plan: 'promo_pro', entitlementSource: 'promo' }), FREE_PLAN_EXPIRATION_DAYS);
    assert.equal(resolvePlanExpirationDays({ plan: 'pro', entitlementSource: 'paid' }), PAID_PRO_PLAN_EXPIRATION_DAYS);
    assert.equal(formatExpirationWindowLabel(PAID_PRO_PLAN_EXPIRATION_DAYS), '30 days');
  });

  await run('mid-cycle upgrades prorate the remaining expiration window upward', () => {
    const nextExpiry = prorateExpirationTimestamp({
      currentExpiresAt: '2026-03-14T00:00:00.000Z',
      previousExpirationDays: 14,
      nextExpirationDays: 30,
      now: new Date('2026-03-07T00:00:00.000Z'),
    });
    assert.equal(nextExpiry, '2026-03-22T00:00:00.000Z');
  });

  await run('mid-cycle downgrades prorate the remaining expiration window downward', () => {
    const nextExpiry = prorateExpirationTimestamp({
      currentExpiresAt: '2026-03-22T00:00:00.000Z',
      previousExpirationDays: 30,
      nextExpirationDays: 14,
      now: new Date('2026-03-07T00:00:00.000Z'),
    });
    assert.equal(nextExpiry, '2026-03-14T00:00:00.000Z');
  });

  await run('plan transition fallback updates entitlement, profile, subscription, and audit rows together', async () => {
    const supabase = new FakeSupabase();

    const result = await applyPlanTransition(supabase as any, {
      userId: 'user-1',
      targetPlan: 'pro',
      entitlementSource: 'paid',
      entitlementEndsAt: '2026-04-06T00:00:00.000Z',
      source: 'test_suite',
      reason: 'upgrade',
      traceId: 'trace-upgrade',
      subscription: {
        planKey: 'pro_monthly',
        status: 'active',
        startsAt: '2026-03-07T00:00:00.000Z',
        endsAt: '2026-04-06T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        metadata: { scenario: 'upgrade' },
      },
    });

    assert.equal(result.plan, 'pro');
    assert.equal(result.entitlementSource, 'paid');
    assert.equal(result.expiresAt, '2026-04-06T00:00:00.000Z');
    assert.equal(supabase.maps.au_user_entitlements.get('user-1')?.plan, 'pro');
    assert.equal(supabase.maps.au_user_entitlements.get('user-1')?.source, 'paid');
    assert.equal(supabase.maps.au_user_profiles.get('user-1')?.tier, 'pro');
    assert.equal(supabase.maps.billing_subscriptions.get('user-1')?.status, 'active');
    assert.equal(supabase.auditRows.length, 1);

    await applyPlanTransition(supabase as any, {
      userId: 'user-1',
      targetPlan: 'free',
      entitlementSource: 'none',
      entitlementEndsAt: null,
      source: 'test_suite',
      reason: 'downgrade',
      traceId: 'trace-downgrade',
    });

    assert.equal(supabase.maps.au_user_entitlements.get('user-1')?.plan, 'free');
    assert.equal(supabase.maps.au_user_entitlements.get('user-1')?.source, 'none');
    assert.equal(supabase.maps.au_user_profiles.get('user-1')?.tier, 'free');
    assert.equal(supabase.auditRows.length, 2);
  });

  await run('concurrent transitions for the same user are serialized before the RPC runs', async () => {
    const supabase = new FakeSupabase();
    supabase.mode = 'success';
    supabase.delayMs = 25;

    await Promise.all([
      applyPlanTransition(supabase as any, {
        userId: 'user-2',
        targetPlan: 'pro',
        entitlementSource: 'paid',
        entitlementEndsAt: '2026-04-06T00:00:00.000Z',
        source: 'test_suite',
        traceId: 'trace-a',
      }),
      applyPlanTransition(supabase as any, {
        userId: 'user-2',
        targetPlan: 'free',
        entitlementSource: 'none',
        entitlementEndsAt: null,
        source: 'test_suite',
        traceId: 'trace-b',
      }),
    ]);

    assert.equal(supabase.rpcCalls.length, 2);
    assert.equal(supabase.maxConcurrentRpcs, 1);
  });

  await run('high-concurrency bursts still serialize plan transitions per user', async () => {
    const supabase = new FakeSupabase();
    supabase.mode = 'success';
    supabase.delayMs = 10;

    const transitions = Array.from({ length: 12 }, (_, index) =>
      applyPlanTransition(supabase as any, {
        userId: 'user-load',
        targetPlan: index % 2 === 0 ? 'pro' : 'free',
        entitlementSource: index % 2 === 0 ? 'paid' : 'none',
        entitlementEndsAt: index % 2 === 0 ? '2026-04-06T00:00:00.000Z' : null,
        source: 'test_suite',
        traceId: `trace-load-${index}`,
      }),
    );

    await Promise.all(transitions);

    assert.equal(supabase.rpcCalls.length, 12);
    assert.equal(supabase.maxConcurrentRpcs, 1);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
