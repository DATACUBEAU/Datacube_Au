import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAiUsageReservationPayload } from '../src/lib/server/ai-usage-accounting.js';

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

function limitsFixture(resetPolicy: string) {
  const rule = (value: number) => ({
    value,
    isEnabled: true,
    isUnlimited: false,
    mode: 'usage',
    resetPolicy,
    resetIntervalValue: null,
    resetIntervalUnit: null,
  });

  return {
    effectivePlan: { hasPro: false },
    limitRules: {
      max_chats_total: rule(10),
      max_tokens_total: rule(10000),
      max_knowledge_hub: rule(10),
      max_practice_exams: rule(10),
      max_exam_predictions: rule(10),
    },
  } as any;
}

const chatOperation = {
  featureKey: 'au_chat',
  requestFeature: 'au-chat',
  gatewayRoute: '/chat/au-chat',
} as any;

async function main() {
  await run('weekly canonical AI quotas use the active quota window', () => {
    const payload = buildAiUsageReservationPayload({
      limits: limitsFixture('weekly'),
      operation: chatOperation,
      idempotencyKey: 'chat_weekly_123456',
      body: { feature: 'au-chat', messages: [{ role: 'user', content: 'hello' }] },
    });

    const check = payload.limitChecks.find((entry) => entry.metric_key === 'max_chats_total');
    assert.equal(check?.counter_scope, 'window');
    assert.ok(check?.window_start);
    assert.ok(check?.window_end);
  });

  await run('never canonical AI quotas remain lifetime scoped', () => {
    const payload = buildAiUsageReservationPayload({
      limits: limitsFixture('never'),
      operation: chatOperation,
      idempotencyKey: 'chat_never_12345678',
      body: { feature: 'au-chat', messages: [{ role: 'user', content: 'hello' }] },
    });

    const check = payload.limitChecks.find((entry) => entry.metric_key === 'max_chats_total');
    assert.equal(check?.counter_scope, 'total');
  });

  await run('reservation SQL reads committed and active window usage before enforcing non-daily caps', () => {
    const sql = readFileSync('supabase/migrations/20260829215500_ai_reservation_admin_adjustments.sql', 'utf8');
    assert.match(sql, /v_counter_scope NOT IN \('today', 'total', 'window'\)/i);
    assert.match(sql, /v_counter_scope = 'window'[\s\S]+get_usage_metric_window_totals/i);
    assert.match(sql, /ARRAY\[v_metric_key\]::TEXT\[\]/i);
    assert.match(sql, /v_current := public\.ai_usage_jsonb_numeric_value\(COALESCE\(v_window_totals/i);
    assert.match(sql, /FROM public\.ai_usage_reservations AS r/i);
    assert.match(sql, /r\.status = 'reserved'/i);
    assert.match(sql, /r\.expires_at > now\(\)/i);
    assert.match(sql, /r\.created_at >= v_window_start/i);
    assert.match(sql, /v_window_end IS NULL OR r\.created_at < v_window_end/i);
    assert.match(sql, /ai_usage_jsonb_numeric_value\([\s\S]+r\.reserved_units[\s\S]+v_metric_key/i);
    assert.match(sql, /v_current := v_current \+ COALESCE\(v_active_reserved, 0\)/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });

  if (failed > 0) process.exit(1);
}

main();
