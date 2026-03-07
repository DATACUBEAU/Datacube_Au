"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const subscription_policy_js_1 = require("../src/lib/plans/subscription-policy.js");
const plan_sync_js_1 = require("../src/lib/server/plan-sync.js");
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
class FakeTable {
    constructor(supabase, table) {
        this.supabase = supabase;
        this.table = table;
    }
    async upsert(payload) {
        if (this.table === 'au_user_entitlements' || this.table === 'au_user_profiles' || this.table === 'billing_subscriptions') {
            this.supabase.maps[this.table].set(String(payload.user_id || ''), payload);
            return { data: payload, error: null };
        }
        throw new Error(`Unsupported upsert table: ${this.table}`);
    }
    async insert(payload) {
        if (this.table === 'entitlement_audit') {
            this.supabase.auditRows.push(payload);
            return { data: payload, error: null };
        }
        throw new Error(`Unsupported insert table: ${this.table}`);
    }
}
class FakeSupabase {
    constructor() {
        this.mode = 'missing';
        this.delayMs = 0;
        this.concurrentRpcs = 0;
        this.maxConcurrentRpcs = 0;
        this.rpcCalls = [];
        this.maps = {
            au_user_entitlements: new Map(),
            au_user_profiles: new Map(),
            billing_subscriptions: new Map(),
        };
        this.auditRows = [];
    }
    from(table) {
        return new FakeTable(this, table);
    }
    async rpc(name, payload) {
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
        const beforeMidnight = (0, subscription_policy_js_1.computeUtcQuotaWindowBounds)(1, new Date('2026-03-07T23:59:59.000Z'));
        const afterMidnight = (0, subscription_policy_js_1.computeUtcQuotaWindowBounds)(1, new Date('2026-03-08T00:00:00.000Z'));
        strict_1.default.equal(beforeMidnight.start, '2026-03-07T00:00:00.000Z');
        strict_1.default.equal(beforeMidnight.end, '2026-03-08T00:00:00.000Z');
        strict_1.default.equal(afterMidnight.start, '2026-03-08T00:00:00.000Z');
        strict_1.default.equal(afterMidnight.end, '2026-03-09T00:00:00.000Z');
    });
    await run('non-resetting quotas stay on the lifetime window', () => {
        const lifetimeWindow = (0, subscription_policy_js_1.computeUtcQuotaWindowBounds)(0, new Date('2026-03-07T12:00:00.000Z'));
        strict_1.default.equal(lifetimeWindow.start, '1970-01-01T00:00:00.000Z');
        strict_1.default.equal(lifetimeWindow.end, null);
    });
    await run('expiration policy keeps promo at 14 days and paid Pro at 30 days', () => {
        strict_1.default.equal((0, subscription_policy_js_1.resolvePlanExpirationDays)({ plan: 'free', entitlementSource: 'none' }), subscription_policy_js_1.FREE_PLAN_EXPIRATION_DAYS);
        strict_1.default.equal((0, subscription_policy_js_1.resolvePlanExpirationDays)({ plan: 'promo_pro', entitlementSource: 'promo' }), subscription_policy_js_1.FREE_PLAN_EXPIRATION_DAYS);
        strict_1.default.equal((0, subscription_policy_js_1.resolvePlanExpirationDays)({ plan: 'pro', entitlementSource: 'paid' }), subscription_policy_js_1.PAID_PRO_PLAN_EXPIRATION_DAYS);
        strict_1.default.equal((0, subscription_policy_js_1.formatExpirationWindowLabel)(subscription_policy_js_1.PAID_PRO_PLAN_EXPIRATION_DAYS), '30 days');
    });
    await run('mid-cycle upgrades prorate the remaining expiration window upward', () => {
        const nextExpiry = (0, subscription_policy_js_1.prorateExpirationTimestamp)({
            currentExpiresAt: '2026-03-14T00:00:00.000Z',
            previousExpirationDays: 14,
            nextExpirationDays: 30,
            now: new Date('2026-03-07T00:00:00.000Z'),
        });
        strict_1.default.equal(nextExpiry, '2026-03-22T00:00:00.000Z');
    });
    await run('mid-cycle downgrades prorate the remaining expiration window downward', () => {
        const nextExpiry = (0, subscription_policy_js_1.prorateExpirationTimestamp)({
            currentExpiresAt: '2026-03-22T00:00:00.000Z',
            previousExpirationDays: 30,
            nextExpirationDays: 14,
            now: new Date('2026-03-07T00:00:00.000Z'),
        });
        strict_1.default.equal(nextExpiry, '2026-03-14T00:00:00.000Z');
    });
    await run('plan transition fallback updates entitlement, profile, subscription, and audit rows together', async () => {
        const supabase = new FakeSupabase();
        const result = await (0, plan_sync_js_1.applyPlanTransition)(supabase, {
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
        strict_1.default.equal(result.plan, 'pro');
        strict_1.default.equal(result.entitlementSource, 'paid');
        strict_1.default.equal(result.expiresAt, '2026-04-06T00:00:00.000Z');
        strict_1.default.equal(supabase.maps.au_user_entitlements.get('user-1')?.plan, 'pro');
        strict_1.default.equal(supabase.maps.au_user_entitlements.get('user-1')?.source, 'paid');
        strict_1.default.equal(supabase.maps.au_user_profiles.get('user-1')?.tier, 'pro');
        strict_1.default.equal(supabase.maps.billing_subscriptions.get('user-1')?.status, 'active');
        strict_1.default.equal(supabase.auditRows.length, 1);
        await (0, plan_sync_js_1.applyPlanTransition)(supabase, {
            userId: 'user-1',
            targetPlan: 'free',
            entitlementSource: 'none',
            entitlementEndsAt: null,
            source: 'test_suite',
            reason: 'downgrade',
            traceId: 'trace-downgrade',
        });
        strict_1.default.equal(supabase.maps.au_user_entitlements.get('user-1')?.plan, 'free');
        strict_1.default.equal(supabase.maps.au_user_entitlements.get('user-1')?.source, 'none');
        strict_1.default.equal(supabase.maps.au_user_profiles.get('user-1')?.tier, 'free');
        strict_1.default.equal(supabase.auditRows.length, 2);
    });
    await run('concurrent transitions for the same user are serialized before the RPC runs', async () => {
        const supabase = new FakeSupabase();
        supabase.mode = 'success';
        supabase.delayMs = 25;
        await Promise.all([
            (0, plan_sync_js_1.applyPlanTransition)(supabase, {
                userId: 'user-2',
                targetPlan: 'pro',
                entitlementSource: 'paid',
                entitlementEndsAt: '2026-04-06T00:00:00.000Z',
                source: 'test_suite',
                traceId: 'trace-a',
            }),
            (0, plan_sync_js_1.applyPlanTransition)(supabase, {
                userId: 'user-2',
                targetPlan: 'free',
                entitlementSource: 'none',
                entitlementEndsAt: null,
                source: 'test_suite',
                traceId: 'trace-b',
            }),
        ]);
        strict_1.default.equal(supabase.rpcCalls.length, 2);
        strict_1.default.equal(supabase.maxConcurrentRpcs, 1);
    });
    await run('high-concurrency bursts still serialize plan transitions per user', async () => {
        const supabase = new FakeSupabase();
        supabase.mode = 'success';
        supabase.delayMs = 10;
        const transitions = Array.from({ length: 12 }, (_, index) => (0, plan_sync_js_1.applyPlanTransition)(supabase, {
            userId: 'user-load',
            targetPlan: index % 2 === 0 ? 'pro' : 'free',
            entitlementSource: index % 2 === 0 ? 'paid' : 'none',
            entitlementEndsAt: index % 2 === 0 ? '2026-04-06T00:00:00.000Z' : null,
            source: 'test_suite',
            traceId: `trace-load-${index}`,
        }));
        await Promise.all(transitions);
        strict_1.default.equal(supabase.rpcCalls.length, 12);
        strict_1.default.equal(supabase.maxConcurrentRpcs, 1);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
