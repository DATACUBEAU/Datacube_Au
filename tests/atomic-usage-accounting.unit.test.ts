import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAiUsageReservationPayload,
  normalizeAiIdempotencyKey,
  releaseReservedAiUsage,
  reserveAiUsage,
  reserveFailureStatus,
} from '../src/lib/server/ai-usage-accounting.js';

let failed = 0;
type AsyncTest = () => void | Promise<void>;

async function run(name: string, fn: AsyncTest) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error: any) { failed += 1; console.error(`FAIL ${name}`); console.error(error?.stack || error); }
}

class FakeSupabase {
  calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  response: Record<string, unknown> = {
    ok: true,
    reservation_id: '11111111-1111-4111-8111-111111111111',
    idempotency_key: 'chat_123456789abc',
    status: 'reserved',
  };
  async rpc(name: string, payload: Record<string, unknown>) {
    this.calls.push({ name, payload });
    return { data: this.response, error: null };
  }
}

function limitsFixture(overrides?: Record<string, Partial<Record<'value' | 'isEnabled' | 'isUnlimited', any>>>) {
  const rule = (value: number | null, extra?: Record<string, unknown>) => ({
    value, isEnabled: true, isUnlimited: false, mode: 'usage', resetPolicy: 'daily',
    resetIntervalValue: null, resetIntervalUnit: null, ...extra,
  });
  return {
    plan: 'free',
    effectivePlan: { hasPro: false },
    limitRules: {
      max_chats_total: rule(overrides?.max_chats_total?.value ?? 3),
      max_tokens_total: rule(overrides?.max_tokens_total?.value ?? 2000),
      max_knowledge_hub: rule(overrides?.max_knowledge_hub?.value ?? 4),
      max_practice_exams: rule(overrides?.max_practice_exams?.value ?? 2),
      max_exam_predictions: rule(overrides?.max_exam_predictions?.value ?? 2),
    },
    usage: { total: {}, by_limit: {} },
  } as any;
}

const chatOperation = {
  requestFeature: 'au-chat',
  featureKey: 'au_chat',
  gatewayRoute: '/chat/au-chat',
};
const promptOperation = {
  requestFeature: 'generate-prompt-starters',
  featureKey: 'prompt_starters',
  gatewayRoute: '/generate/prompt-starters',
};

async function main() {
  await run('idempotency keys are reused when valid and rejected when malformed', () => {
    assert.equal(normalizeAiIdempotencyKey('chat_123456789abc'), 'chat_123456789abc');
    assert.equal(normalizeAiIdempotencyKey('short', 'chat'), '');
    assert.equal(normalizeAiIdempotencyKey('bad key with spaces', 'chat'), '');
    assert.equal(normalizeAiIdempotencyKey('', 'chat'), '');
  });

  await run('chat reservation payload reserves one chat plus a bounded token estimate', () => {
    const payload = buildAiUsageReservationPayload({
      limits: limitsFixture(), operation: chatOperation,
      idempotencyKey: 'chat_123456789abc',
      body: { feature: 'au-chat', messages: [{ role: 'user', content: 'Explain photosynthesis.' }] },
    });
    assert.equal(payload.increments.max_chats_total, 1);
    assert.equal(payload.increments.api_calls, 1);
    assert.ok(Number(payload.increments.max_tokens_total) >= 768);
    const chatCheck = payload.limitChecks.find(entry => entry.metric_key === 'max_chats_total');
    const tokenCheck = payload.limitChecks.find(entry => entry.metric_key === 'max_tokens_total');
    assert.equal(chatCheck?.counter_scope, 'today');
    assert.equal(tokenCheck?.counter_scope, 'today');
    assert.match(String(chatCheck?.window_start || ''), /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    assert.match(String(chatCheck?.window_end || ''), /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    assert.match(payload.requestFingerprint, /^[a-f0-9]{64}$/);
  });

  await run('prompt starters reserve the prompt quota metric', () => {
    const payload = buildAiUsageReservationPayload({
      limits: limitsFixture(), operation: promptOperation,
      idempotencyKey: 'prompt_starters_123456789abc',
      body: { feature: 'generate-prompt-starters', documentId: 'doc-1' },
    });
    assert.equal(payload.increments.prompt_starters_per_day, 1);
    assert.equal(payload.increments.api_calls, 1);
    assert.ok(payload.limitChecks.some(entry => entry.metric_key === 'prompt_starters_per_day' && entry.counter_scope === 'today'));
  });

  await run('reserveAiUsage calls only the atomic reservation RPC and does not pre-commit usage', async () => {
    const supabase = new FakeSupabase();
    const reservation = buildAiUsageReservationPayload({
      limits: limitsFixture(), operation: chatOperation,
      idempotencyKey: 'chat_123456789abc',
      body: { feature: 'au-chat', messages: [{ role: 'user', content: 'Hi' }] },
    });
    const result = await reserveAiUsage({
      supabase: supabase as any,
      userId: '00000000-0000-4000-8000-000000000001',
      featureKey: chatOperation.featureKey,
      route: chatOperation.gatewayRoute,
      idempotencyKey: 'chat_123456789abc',
      ticketId: 'operation-1',
      reservation,
    });
    assert.equal(result.ok, true);
    assert.equal(supabase.calls.length, 1);
    assert.equal(supabase.calls[0]?.name, 'reserve_ai_usage');
    assert.equal((supabase.calls[0]?.payload.p_metric_increments as any).max_chats_total, 1);
    const checks = supabase.calls[0]?.payload.p_limit_checks as any[];
    assert.ok(checks.some(entry => entry.scope === 'canonical_plan' && entry.window_start));
  });

  await run('failed downstream initiation can release a reserved usage claim safely', async () => {
    const supabase = new FakeSupabase();
    supabase.response = { ok: true, code: null, status: 'released' };
    const result = await releaseReservedAiUsage({
      supabase: supabase as any,
      userId: '00000000-0000-4000-8000-000000000001',
      featureKey: 'au_chat',
      route: '/chat/au-chat',
      idempotencyKey: 'chat_123456789abc',
      ticketId: 'operation-1',
      reservationId: '11111111-1111-4111-8111-111111111111',
      failureCode: 'UPSTREAM_INITIATION_FAILED',
    });
    assert.equal(result.ok, true);
    assert.equal(supabase.calls.length, 1);
    assert.equal(supabase.calls[0]?.name, 'release_ai_usage');
    assert.equal(supabase.calls[0]?.payload.p_user_id, '00000000-0000-4000-8000-000000000001');
    assert.equal(supabase.calls[0]?.payload.p_feature_key, 'au_chat');
    assert.equal(supabase.calls[0]?.payload.p_route, '/chat/au-chat');
    assert.equal(supabase.calls[0]?.payload.p_status, 'released');
  });

  await run('reservation failures map limits and inactive states safely', () => {
    assert.equal(reserveFailureStatus('USAGE_LIMIT_EXCEEDED', 'rejected'), 429);
    assert.equal(reserveFailureStatus('USAGE_RESERVATION_FINGERPRINT_MISMATCH', 'reserved'), 409);
    assert.equal(reserveFailureStatus('USAGE_RESERVATION_NOT_ACTIVE', 'committed'), 409);
    assert.equal(reserveFailureStatus('INVALID_USAGE_RESERVATION', null), 400);
  });

  await run('atomic reservation migrations retain row locks, idempotency and service-only execution', () => {
    const sql = readFileSync('supabase/migrations/20260728153000_atomic_usage_accounting.sql', 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ai_usage_reservations/i);
    assert.match(sql, /idx_ai_usage_reservations_user_feature_idempotency/i);
    assert.match(sql, /FOR UPDATE/i);
    assert.match(sql, /FOR UPDATE SKIP LOCKED/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reserve_ai_usage/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.commit_ai_usage/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.release_ai_usage/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.expire_ai_usage_reservations/i);
    assert.match(sql, /v_row\.user_id <> p_user_id[\s\S]+USAGE_RESERVATION_CLAIM_MISMATCH/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reserve_ai_usage[\s\S]+TO service_role/i);
    assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.reserve_ai_usage[\s\S]+TO authenticated/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\s+public\.au_users\b|\bRESET\b/i);
  });

  await run('daily limit-scope migration preserves canonical and total counter checks', () => {
    const sql = readFileSync('supabase/migrations/20260728154500_atomic_usage_limit_scope_fix.sql', 'utf8');
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reserve_ai_usage/i);
    assert.match(sql, /v_counter_scope = 'today'/);
    assert.match(sql, /public\.ai_usage_jsonb_numeric_value\(COALESCE\(v_today/);
    assert.match(sql, /public\.ai_usage_jsonb_numeric_value\(COALESCE\(v_total/);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bRESET\b/i);
  });

  await run('replay guard rejects payload-swapped idempotency and duplicate provider starts', () => {
    const sql = readFileSync('supabase/migrations/20260728160000_atomic_usage_replay_guard.sql', 'utf8');
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reserve_ai_usage/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.begin_ai_usage_reservation/i);
    assert.match(sql, /USAGE_RESERVATION_FINGERPRINT_MISMATCH/);
    assert.match(sql, /v_existing\.request_fingerprint/);
    assert.match(sql, /v_row\.provider_started_at IS NOT NULL/);
    assert.doesNotMatch(sql, /now\(\) - interval '2 minutes'/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bRESET\b/i);
  });

  await run('admin corrections remain inside the atomic quota transaction', () => {
    const sql = readFileSync('supabase/migrations/20260829215500_ai_reservation_admin_adjustments.sql', 'utf8');
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reserve_ai_usage/i);
    assert.match(sql, /v_limit_scope = 'canonical_plan'/);
    assert.match(sql, /window_start/);
    assert.match(sql, /public\.get_usage_admin_adjustment_total\(/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /concat_ws\('\|', p_user_id::TEXT, v_metric_key, v_window_start::TEXT/);
    assert.match(sql, /v_current := GREATEST\(0, v_current \+ COALESCE\(v_adjustment, 0\)\)/);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });

  await run('actual usage settlement merges provider totals with reserved feature units atomically', () => {
    const settlement = readFileSync('supabase/migrations/20261115220430_merge_actual_usage_with_reserved_units.sql', 'utf8');
    assert.match(settlement, /v_actual_units := COALESCE\(v_row\.reserved_units, '\{\}'::jsonb\) \|\| COALESCE\(p_actual_units, '\{\}'::jsonb\)/);
    assert.match(settlement, /ai_usage_delta_units\(v_actual_units, v_row\.reserved_units\)/);
    assert.match(settlement, /ON CONFLICT \(user_id, event_key\) DO NOTHING/);
  });

  if (failed > 0) process.exit(1);
}
main().catch(error => { console.error(error); process.exit(1); });
