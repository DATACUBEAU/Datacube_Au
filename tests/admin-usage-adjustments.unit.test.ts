import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveUsageMetricForRule } from '../src/lib/server/usage-tracking.js';

let failed = 0;

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

class FakeSupabase {
  adjustment = 0;
  adjustmentRpcMissing = false;
  rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];

  async rpc(name: string, payload: Record<string, unknown>) {
    this.rpcCalls.push({ name, payload });
    if (name === 'get_usage_admin_adjustment_total') {
      if (this.adjustmentRpcMissing) {
        return { data: null, error: { code: '42883', message: 'function does not exist' } };
      }
      return { data: this.adjustment, error: null };
    }
    if (name === 'get_usage_metric_window_totals') {
      return { data: {}, error: null };
    }
    throw new Error(`Unsupported rpc ${name}`);
  }
}

const dailyUsageRule = {
  mode: 'usage',
  resetPolicy: 'daily',
  resetIntervalValue: null,
  resetIntervalUnit: null,
} as any;

async function main() {
  await run('negative admin adjustment can hard-reset effective current-window usage without changing tracked history', async () => {
    const supabase = new FakeSupabase();
    supabase.adjustment = -10;

    const result = await resolveUsageMetricForRule({
      supabase: supabase as any,
      userId: 'user-1',
      metricKey: 'max_chats_total',
      rule: dailyUsageRule,
      fallbackUsed: 10,
      todayCounters: { max_chats_total: 10 },
      totalCounters: { max_chats_total: 40 },
    });

    assert.equal(result.trackedUsed, 10);
    assert.equal(result.effectiveUsed, 0);
    assert.equal(result.source, 'admin_adjusted');
    assert.equal(supabase.rpcCalls.at(-1)?.name, 'get_usage_admin_adjustment_total');
  });

  await run('positive admin adjustment increases the same canonical effective usage used for enforcement', async () => {
    const supabase = new FakeSupabase();
    supabase.adjustment = 5;

    const result = await resolveUsageMetricForRule({
      supabase: supabase as any,
      userId: 'user-1',
      metricKey: 'max_tokens_total',
      rule: dailyUsageRule,
      fallbackUsed: 10,
      todayCounters: { max_tokens_total: 10 },
      totalCounters: { max_tokens_total: 100 },
    });

    assert.equal(result.effectiveUsed, 15);
    assert.equal(result.source, 'admin_adjusted');
  });

  await run('admin decreases clamp effective usage at zero', async () => {
    const supabase = new FakeSupabase();
    supabase.adjustment = -1000;

    const result = await resolveUsageMetricForRule({
      supabase: supabase as any,
      userId: 'user-1',
      metricKey: 'max_chats_total',
      rule: dailyUsageRule,
      fallbackUsed: 2,
      todayCounters: { max_chats_total: 2 },
      totalCounters: { max_chats_total: 2 },
    });

    assert.equal(result.effectiveUsed, 0);
  });

  await run('missing adjustment RPC preserves pre-migration usage during rolling deploys', async () => {
    const supabase = new FakeSupabase();
    supabase.adjustmentRpcMissing = true;

    const result = await resolveUsageMetricForRule({
      supabase: supabase as any,
      userId: 'user-1',
      metricKey: 'max_chats_total',
      rule: dailyUsageRule,
      fallbackUsed: 7,
      todayCounters: { max_chats_total: 7 },
      totalCounters: { max_chats_total: 22 },
    });

    assert.equal(result.effectiveUsed, 7);
    assert.equal(result.source, 'tracked');
  });

  await run('current/capacity limits never use admin usage adjustment deltas', async () => {
    const supabase = new FakeSupabase();
    supabase.adjustment = -99;

    const result = await resolveUsageMetricForRule({
      supabase: supabase as any,
      userId: 'user-1',
      metricKey: 'max_uploads_total',
      rule: { ...dailyUsageRule, mode: 'current', resetPolicy: 'never' } as any,
      fallbackUsed: 4,
      todayCounters: { max_uploads_total: 10 },
      totalCounters: { max_uploads_total: 10 },
    });

    assert.equal(result.effectiveUsed, 4);
    assert.equal(result.source, 'limit_snapshot');
    assert.equal(supabase.rpcCalls.length, 0);
  });

  await run('migration keeps admin usage corrections append-only and window-scoped', () => {
    const sql = readFileSync('supabase/migrations/20260827135000_admin_usage_adjustments.sql', 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.au_usage_admin_adjustments/);
    assert.match(sql, /window_start TIMESTAMPTZ NOT NULL/);
    assert.match(sql, /UNIQUE \(user_id, metric_key, request_id\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_adjust_usage/);
    assert.match(sql, /public\.is_conex_admin/);
    assert.doesNotMatch(sql, /DELETE\s+FROM\s+public\.au_usage_events/i);
    assert.doesNotMatch(sql, /TRUNCATE\s+.*au_usage_events/i);
  });

  await run('admin usage API exposes reset-all but blocks non-usage metrics through the canonical rule mode', () => {
    const route = readFileSync('src/app/api/admin/limits/user-usage/route.ts', 'utf8');
    assert.match(route, /'reset_all'/);
    assert.match(route, /rule\.mode !== 'usage'/);
    assert.match(route, /reason: z\.string\(\)\.trim\(\)\.min\(3\)/);
    assert.match(route, /admin_adjust_usage/);
  });

  await run('reset-all request ids stay within the database idempotency-key limit', () => {
    const route = readFileSync('src/app/api/admin/limits/user-usage/route.ts', 'utf8');
    assert.match(route, /MAX_USAGE_ADJUSTMENT_REQUEST_ID_LENGTH = 200/);
    assert.match(route, /scopedUsageAdjustmentRequestId\(rootRequestId, key\)/);
    assert.match(route, /createHash\('sha256'\)\.update\(rootRequestId\)/);
    assert.doesNotMatch(route, /requestId: `\$\{rootRequestId\}:\$\{key\}`/);
  });

  await run('simple plan editor stays plan-scoped and refuses to turn capacity rules into usage rules', () => {
    const route = readFileSync('src/app/api/admin/limits/simple-plan-rule/route.ts', 'utf8');
    assert.match(route, /plan: z\.enum\(DEFAULT_PLAN_ORDER\)/);
    assert.match(route, /effective\.mode !== 'usage'/);
    assert.match(route, /state\.storedRulesByScope\[input\.plan\]/);
    assert.match(route, /savePlanLimitScopeRules/);
    assert.match(route, /scope: input\.plan/);
    assert.doesNotMatch(route, /scope:\s*'default'/);
  });

  await run('simple admin UI clearly separates user-only usage resets from plan-wide cap edits', () => {
    const page = readFileSync('src/app/conex/usage/page.tsx', 'utf8');
    assert.match(page, /A cap change is plan-wide\. A usage reset above affects only the selected user\./);
    assert.match(page, /Hard reset usage/);
    assert.match(page, /Increase or decrease this number to change the allowance for the whole plan\./);
    assert.match(page, /Advanced plan limits/);
  });

  if (failed > 0) process.exit(1);
}

void main();
