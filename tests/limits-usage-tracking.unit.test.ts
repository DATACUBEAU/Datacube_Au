import assert from 'node:assert/strict';
import {
  buildChatTrackingPayload,
  buildFeatureUsageIncrements,
  buildUploadUsageIncrements,
  buildUsageEventKey,
  buildUsageHealthReport,
  loadTrackedUsageWindowTotals,
  resolveUsageMetricForRule,
  trackUsageEvent,
  type UsageMetricDefinitionRow,
} from '../src/lib/server/usage-tracking.js';
import { buildPlanLimitPresentation } from '../src/lib/limits/plan-limit-model.js';
import { readUsageMetricValue } from '../shared/usage-metrics.js';

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

class FakeSelectBuilder {
  private filters = new Map<string, unknown>();

  constructor(
    private readonly rows: Array<Record<string, unknown>>,
    private readonly allowError: boolean,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }

  async maybeSingle() {
    if (this.allowError) {
      return { data: null, error: { code: '42P01', message: 'missing table' } };
    }
    const row = this.rows.find((entry) =>
      Array.from(this.filters.entries()).every(([column, value]) => entry[column] === value),
    );
    return { data: row || null, error: null };
  }
}

class FakeSupabase {
  rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  dedupe = new Set<string>();
  todayCounters: Record<string, unknown> = {};
  totalCounters: Record<string, unknown> = {};
  windowTotals: Record<string, number> = {};
  missingRpc = false;

  from(table: string) {
    if (table === 'usage_counters') {
      return new FakeSelectBuilder([{ user_id: 'user-1', day: new Date().toISOString().slice(0, 10), counters: this.todayCounters }], false);
    }
    if (table === 'usage_totals') {
      return new FakeSelectBuilder([{ user_id: 'user-1', counters: this.totalCounters }], false);
    }
    throw new Error(`Unsupported table ${table}`);
  }

  async rpc(name: string, payload: Record<string, unknown>) {
    this.rpcCalls.push({ name, payload });
    if (this.missingRpc) {
      return { data: null, error: { code: '42883', message: 'function does not exist' } };
    }

    if (name === 'track_usage_event') {
      const eventKey = String(payload.p_event_key || '');
      const metrics = ((payload.p_metrics || {}) as Record<string, unknown>);
      const deduped = this.dedupe.has(eventKey);
      if (!deduped) {
        this.dedupe.add(eventKey);
        for (const [key, raw] of Object.entries(metrics)) {
          const value = Number(raw);
          this.todayCounters[key] = (Number(this.todayCounters[key] || 0) || 0) + value;
          this.totalCounters[key] = (Number(this.totalCounters[key] || 0) || 0) + value;
        }
      }
      return {
        data: {
          ok: true,
          deduped,
          event_id: deduped ? 'evt-existing' : `evt-${this.dedupe.size}`,
          event_key: eventKey,
          snapshot: { today: this.todayCounters, total: this.totalCounters },
        },
        error: null,
      };
    }

    if (name === 'get_usage_metric_window_totals') {
      return { data: this.windowTotals, error: null };
    }

    throw new Error(`Unsupported rpc ${name}`);
  }
}

const definitions: UsageMetricDefinitionRow[] = [
  {
    metric_key: 'max_chats_total',
    label: 'Chats',
    unit: 'messages',
    category: 'chat',
    limit_key: 'max_chats_total',
    reset_policy: 'daily',
    reset_interval_value: null,
    reset_interval_unit: null,
    is_enabled: true,
    is_integer: true,
    min_value: 0,
    max_value: null,
    description: 'Chats',
  },
  {
    metric_key: 'api_calls',
    label: 'API Calls',
    unit: 'calls',
    category: 'api',
    limit_key: null,
    reset_policy: 'daily',
    reset_interval_value: null,
    reset_interval_unit: null,
    is_enabled: true,
    is_integer: true,
    min_value: 0,
    max_value: null,
    description: 'API calls',
  },
  {
    metric_key: 'max_uploads_total',
    label: 'Uploads',
    unit: 'files',
    category: 'storage',
    limit_key: 'max_uploads_total',
    reset_policy: 'never',
    reset_interval_value: null,
    reset_interval_unit: null,
    is_enabled: true,
    is_integer: true,
    min_value: 0,
    max_value: null,
    description: 'Current uploads',
  },
];

async function main() {
  await run('chat tracking payload increments exactly one chat and estimates tokens from content + context', () => {
    const payload = buildChatTrackingPayload({
      messages: [
        { role: 'user', content: 'Explain matter in chemistry' },
        { role: 'assistant', content: 'Previous answer' },
      ],
      auGuide: { tone: 'concise' },
      activeDocIds: ['doc-1'],
      sessionId: 'session-1',
      appContext: { page: '/dashboard/chat' },
    });

    assert.equal(payload.increments.max_chats_total, 1);
    assert.equal(payload.increments.messages_count, 1);
    assert.equal(payload.increments.api_calls, 1);
    assert.ok(Number(payload.estimatedTokens) > 5);
    assert.equal(payload.increments.max_tokens_total, payload.estimatedTokens);
  });

  await run('event key is stable and prefers idempotency key', () => {
    const key = buildUsageEventKey({
      feature: 'doc_chat',
      idempotencyKey: 'abc-123',
      requestId: 'req-1',
      correlationId: 'corr-1',
    });
    assert.equal(key, 'doc_chat:idempotency:abc-123');
  });

  await run('feature and upload increments expose dedicated counters', () => {
    assert.deepEqual(buildFeatureUsageIncrements('exam_prediction'), {
      max_exam_predictions: 1,
      prediction_generations: 1,
      used_exams: 1,
      exams_count: 1,
      api_calls: 1,
    });
    const upload = buildUploadUsageIncrements(5 * 1024 * 1024);
    assert.equal(upload.max_uploads_total, 1);
    assert.equal(upload.uploads_count, 1);
    assert.equal(upload.uploaded_bytes, 5 * 1024 * 1024);
    assert.ok(Number(upload.uploaded_mb) >= 5);
  });

  await run('plan limit presentation summaries update from the saved rule metadata', () => {
    const summary = buildPlanLimitPresentation({
      value: 42000,
      isEnabled: true,
      isUnlimited: false,
      mode: 'usage',
      resetPolicy: 'weekly',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      unitLabel: 'messages',
      category: 'usage_counter',
    });

    assert.equal(summary.capLabel, '42,000 messages');
    assert.equal(summary.modeLabel, 'Usage-based');
    assert.equal(summary.resetLabel, 'Weekly');
    assert.equal(summary.summary, '42,000 messages / Usage-based / Weekly');
    assert.equal(summary.resetDescription, 'Resets weekly.');
  });

  await run('plan limit presentation explains per-request and current-count rules without hardcoded page text', () => {
    const perRequest = buildPlanLimitPresentation({
      value: 75,
      isEnabled: true,
      isUnlimited: false,
      mode: 'per_request',
      resetPolicy: 'never',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      unitLabel: 'MB',
      category: 'per_request',
    });
    assert.equal(perRequest.summary, '75 MB / Per request / No reset');
    assert.equal(perRequest.resetDescription, 'Checked on every request. It does not use a scheduled reset window.');

    const currentCount = buildPlanLimitPresentation({
      value: 250,
      isEnabled: true,
      isUnlimited: false,
      mode: 'current',
      resetPolicy: 'never',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      unitLabel: 'files',
      category: 'stored_item',
    });
    assert.equal(currentCount.summary, '250 files / Current count / No reset');
    assert.equal(currentCount.resetDescription, 'Checked against the current stored count. Capacity returns as items are removed.');
  });

  await run('trackUsageEvent writes one atomic event and returns the snapshot', async () => {
    const supabase = new FakeSupabase();
    const result = await trackUsageEvent({
      supabase: supabase as any,
      userId: 'user-1',
      feature: 'doc_chat',
      source: 'test',
      eventKey: 'doc_chat:idempotency:1',
      increments: { max_chats_total: 1, messages_count: 1, api_calls: 1 },
      requestId: 'req-1',
      correlationId: 'corr-1',
      context: { test: true },
    });

    assert.equal(result.tracked, true);
    assert.equal(result.deduped, false);
    assert.equal(readUsageMetricValue((result.snapshot as any)?.total as any, ['max_chats_total']), 1);
    assert.equal(supabase.rpcCalls[0]?.name, 'track_usage_event');
  });

  await run('trackUsageEvent tolerates missing RPC during rollout', async () => {
    const supabase = new FakeSupabase();
    supabase.missingRpc = true;
    const result = await trackUsageEvent({
      supabase: supabase as any,
      userId: 'user-1',
      feature: 'doc_chat',
      source: 'test',
      eventKey: 'doc_chat:idempotency:missing',
      increments: { max_chats_total: 1 },
    });

    assert.equal(result.tracked, false);
    assert.equal(result.eventId, null);
  });

  await run('concurrent duplicates dedupe by event key', async () => {
    const supabase = new FakeSupabase();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        trackUsageEvent({
          supabase: supabase as any,
          userId: 'user-1',
          feature: 'doc_chat',
          source: 'test',
          eventKey: 'doc_chat:idempotency:dupe',
          increments: { max_chats_total: 1, api_calls: 1 },
        }),
      ),
    );

    assert.equal(responses.filter((entry) => entry.deduped).length, 7);
    assert.equal(Number(supabase.totalCounters.max_chats_total || 0), 1);
    assert.equal(Number(supabase.totalCounters.api_calls || 0), 1);
  });

  await run('window totals helper reads rpc payload as numeric values', async () => {
    const supabase = new FakeSupabase();
    supabase.windowTotals = { max_chats_total: 4, api_calls: 9 };
    const totals = await loadTrackedUsageWindowTotals({
      supabase: supabase as any,
      userId: 'user-1',
      metricKeys: ['max_chats_total', 'api_calls'],
      windowStart: '2026-03-15T00:00:00.000Z',
      windowEnd: '2026-03-16T00:00:00.000Z',
    });

    assert.equal(totals.max_chats_total, 4);
    assert.equal(totals.api_calls, 9);
  });

  await run('current-mode limit rules use live snapshot instead of cumulative event totals', async () => {
    const supabase = new FakeSupabase();
    supabase.todayCounters = { max_uploads_total: 9, used_uploads: 9 };
    supabase.totalCounters = { max_uploads_total: 9, used_uploads: 9 };

    const resolved = await resolveUsageMetricForRule({
      supabase: supabase as any,
      userId: 'user-1',
      metricKey: 'max_uploads_total',
      fallbackUsed: 2,
      rule: {
        mode: 'current',
        resetPolicy: 'never',
        resetIntervalValue: null,
        resetIntervalUnit: null,
      } as any,
    });

    assert.equal(resolved.trackedUsed, 0);
    assert.equal(resolved.effectiveUsed, 2);
    assert.equal(resolved.source, 'limit_snapshot');
  });

  await run('health report exposes tracked vs legacy vs effective usage', async () => {
    const supabase = new FakeSupabase();
    supabase.todayCounters = { max_chats_total: 2, api_calls: 5, max_uploads_total: 9 };
    supabase.totalCounters = { max_chats_total: 2, api_calls: 5, max_uploads_total: 9 };
    supabase.windowTotals = { api_calls: 5 };

    const rows = await buildUsageHealthReport({
      supabase: supabase as any,
      userId: 'user-1',
      definitions,
      effectiveLimits: { max_chats_total: 3 } as any,
      usageByLimit: {
        max_chats_total: {
          used: 1,
          mode: 'usage',
          reset: {
            window_start: '2026-03-15T00:00:00.000Z',
            window_end: '2026-03-16T00:00:00.000Z',
          },
        },
        max_uploads_total: {
          used: 3,
          mode: 'current',
          reset: {
            window_start: '1970-01-01T00:00:00.000Z',
            window_end: null,
          },
        },
      },
    });

    const chatRow = rows.find((row) => row.metricKey === 'max_chats_total');
    const apiRow = rows.find((row) => row.metricKey === 'api_calls');
    const uploadRow = rows.find((row) => row.metricKey === 'max_uploads_total');
    assert.equal(chatRow?.source, 'hybrid');
    assert.equal(chatRow?.effectiveUsed, 2);
    assert.equal(chatRow?.withinLimit, true);
    assert.equal(apiRow?.trackedUsed, 5);
    assert.equal(apiRow?.limit, null);
    assert.equal(uploadRow?.source, 'limit_snapshot');
    assert.equal(uploadRow?.trackedUsed, 0);
    assert.equal(uploadRow?.effectiveUsed, 3);
  });

  if (failed > 0) process.exit(1);
}

void main();
