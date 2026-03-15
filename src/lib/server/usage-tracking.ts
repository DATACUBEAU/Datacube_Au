import type { SupabaseClient } from '@supabase/supabase-js';
import { computeResetWindow, type EffectivePlanLimitRule } from '../limits/plan-limit-model';
import {
  TRACKED_USAGE_METRIC_KEYS,
  USAGE_METRIC_ALIASES,
  buildChatUsageIncrements,
  buildFeatureUsageIncrements,
  buildUploadUsageIncrements,
  estimateChatRequestTokens,
  normalizeMetricIncrements,
  readUsageMetricValue,
} from '../../../shared/usage-metrics';

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === '42883' ||
    code.startsWith('PGRST') ||
    message.includes('does not exist') ||
    details.includes('does not exist')
  );
}

export type UsageTrackingResult = {
  tracked: boolean;
  deduped: boolean;
  eventId: string | null;
  eventKey: string;
  snapshot: Record<string, unknown>;
};

export type UsageMetricDefinitionRow = {
  metric_key: string;
  label: string;
  unit: string;
  category: string;
  limit_key: string | null;
  reset_policy: string;
  reset_interval_value: number | null;
  reset_interval_unit: string | null;
  is_enabled: boolean;
  is_integer: boolean;
  min_value: number | null;
  max_value: number | null;
  description: string | null;
};

export type UsageHealthMetricRow = {
  metricKey: string;
  label: string;
  unit: string;
  category: string;
  limitKey: string | null;
  limit: number | null;
  trackedUsed: number;
  legacyUsed: number;
  effectiveUsed: number;
  source: 'tracked' | 'legacy' | 'hybrid' | 'limit_snapshot';
  resetPolicy: string;
  resetWindowStart: string | null;
  resetWindowEnd: string | null;
  withinLimit: boolean;
};

function shouldUseTrackedCountersForRuleMode(mode: string | null | undefined): boolean {
  return String(mode || '').trim().toLowerCase() === 'usage';
}

export function buildUsageEventKey(input: {
  feature: string;
  idempotencyKey?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  fallbackSeed?: string | null;
}): string {
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (idempotencyKey) return `${input.feature}:idempotency:${idempotencyKey}`;

  const requestId = String(input.requestId || '').trim();
  if (requestId) return `${input.feature}:request:${requestId}`;

  const correlationId = String(input.correlationId || '').trim();
  if (correlationId) return `${input.feature}:correlation:${correlationId}`;

  const fallbackSeed = String(input.fallbackSeed || '').trim();
  if (fallbackSeed) return `${input.feature}:fallback:${fallbackSeed}`;

  return `${input.feature}:anonymous`;
}

export function buildChatTrackingPayload(input: {
  messages?: Array<{ role?: string; content?: unknown }>;
  auGuide?: unknown;
  activeDocIds?: string[] | null;
  sessionId?: string | null;
  appContext?: unknown;
  memoryPack?: unknown;
  documentContext?: unknown;
  recentSnippet?: unknown;
  secondarySnippet?: unknown;
}): { estimatedTokens: number; increments: Record<string, number> } {
  const estimatedTokens = estimateChatRequestTokens(input);
  return {
    estimatedTokens,
    increments: buildChatUsageIncrements(estimatedTokens),
  };
}

export async function trackUsageEvent(input: {
  supabase: SupabaseClient;
  userId: string;
  feature: string;
  source: string;
  eventKey: string;
  increments: Record<string, unknown>;
  requestId?: string | null;
  correlationId?: string | null;
  context?: Record<string, unknown>;
}): Promise<UsageTrackingResult> {
  const normalized = normalizeMetricIncrements(input.increments);
  if (!input.userId || !input.feature || !input.eventKey || Object.keys(normalized).length === 0) {
    return {
      tracked: false,
      deduped: false,
      eventId: null,
      eventKey: input.eventKey,
      snapshot: {},
    };
  }

  const { data, error } = await input.supabase.rpc('track_usage_event', {
    p_user_id: input.userId,
    p_event_key: input.eventKey,
    p_feature: input.feature,
    p_source: input.source,
    p_metrics: normalized,
    p_request_id: input.requestId || null,
    p_correlation_id: input.correlationId || null,
    p_context: input.context || {},
  });

  if (error) {
    if (isSchemaDriftError(error)) {
      return {
        tracked: false,
        deduped: false,
        eventId: null,
        eventKey: input.eventKey,
        snapshot: {},
      };
    }
    throw error;
  }

  const payload = (data || {}) as Record<string, unknown>;
  return {
    tracked: payload.ok !== false,
    deduped: payload.deduped === true,
    eventId: typeof payload.event_id === 'string' ? payload.event_id : null,
    eventKey: typeof payload.event_key === 'string' ? payload.event_key : input.eventKey,
    snapshot: (payload.snapshot || {}) as Record<string, unknown>,
  };
}

export async function loadUsageMetricDefinitions(supabase: SupabaseClient): Promise<UsageMetricDefinitionRow[]> {
  const { data, error } = await supabase
    .from('au_usage_metric_definitions')
    .select(
      'metric_key,label,unit,category,limit_key,reset_policy,reset_interval_value,reset_interval_unit,is_enabled,is_integer,min_value,max_value,description',
    )
    .eq('is_enabled', true)
    .order('metric_key', { ascending: true });

  if (error) {
    if (isSchemaDriftError(error)) return [];
    throw error;
  }

  return (data || []) as UsageMetricDefinitionRow[];
}

export async function loadUsageCounterSnapshots(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ today: Record<string, unknown>; total: Record<string, unknown> }> {
  const [todayRes, totalRes] = await Promise.all([
    supabase.from('usage_counters').select('counters').eq('user_id', userId).eq('day', new Date().toISOString().slice(0, 10)).maybeSingle(),
    supabase.from('usage_totals').select('counters').eq('user_id', userId).maybeSingle(),
  ]);

  const today = !todayRes.error && todayRes.data ? (((todayRes.data as any).counters || {}) as Record<string, unknown>) : {};
  const total = !totalRes.error && totalRes.data ? (((totalRes.data as any).counters || {}) as Record<string, unknown>) : {};
  return { today, total };
}

export async function loadTrackedUsageWindowTotals(input: {
  supabase: SupabaseClient;
  userId: string;
  metricKeys: string[];
  windowStart: string | null;
  windowEnd: string | null;
}): Promise<Record<string, number>> {
  const keys = Array.from(new Set(input.metricKeys.map((entry) => String(entry || '').trim()).filter(Boolean)));
  if (!input.userId || keys.length === 0) return {};

  const { data, error } = await input.supabase.rpc('get_usage_metric_window_totals', {
    p_user_id: input.userId,
    p_metric_keys: keys,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
  });

  if (error) {
    if (isSchemaDriftError(error)) return {};
    throw error;
  }

  return Object.entries((data || {}) as Record<string, unknown>).reduce((acc, [key, raw]) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) acc[key] = parsed;
    return acc;
  }, {} as Record<string, number>);
}

export function resolveTrackedMetricValue(source: Record<string, unknown>, metricKey: string): number {
  return readUsageMetricValue(source, USAGE_METRIC_ALIASES[metricKey] || [metricKey], 0);
}

export async function resolveUsageMetricForRule(input: {
  supabase: SupabaseClient;
  userId: string;
  metricKey: string;
  rule: EffectivePlanLimitRule;
  fallbackUsed: number;
  todayCounters?: Record<string, unknown>;
  totalCounters?: Record<string, unknown>;
}): Promise<{ trackedUsed: number; effectiveUsed: number; source: 'tracked' | 'legacy' | 'hybrid' | 'limit_snapshot' }> {
  if (!shouldUseTrackedCountersForRuleMode(input.rule.mode)) {
    return {
      trackedUsed: 0,
      effectiveUsed: Math.max(0, input.fallbackUsed),
      source: 'limit_snapshot',
    };
  }

  const aliases = USAGE_METRIC_ALIASES[input.metricKey] || [input.metricKey];
  const window = computeResetWindow(input.rule);
  let trackedUsed = 0;

  const usingLifetimeWindow = !window.windowEnd && window.windowStart.startsWith('1970-01-01T00:00:00');
  const usingCurrentDayWindow =
    window.policy === 'daily' &&
    window.windowStart === `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

  if (usingLifetimeWindow) {
    trackedUsed = readUsageMetricValue(input.totalCounters || {}, aliases, 0);
  } else if (usingCurrentDayWindow) {
    trackedUsed = readUsageMetricValue(input.todayCounters || {}, aliases, 0);
  } else {
    const totals = await loadTrackedUsageWindowTotals({
      supabase: input.supabase,
      userId: input.userId,
      metricKeys: aliases,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
    });
    trackedUsed = readUsageMetricValue(totals, aliases, 0);
  }

  if (trackedUsed <= 0 && input.fallbackUsed <= 0) {
    return { trackedUsed: 0, effectiveUsed: 0, source: 'tracked' };
  }

  if (trackedUsed > 0 && input.fallbackUsed > 0 && trackedUsed !== input.fallbackUsed) {
    return {
      trackedUsed,
      effectiveUsed: Math.max(trackedUsed, input.fallbackUsed),
      source: 'hybrid',
    };
  }

  if (trackedUsed > 0) {
    return { trackedUsed, effectiveUsed: trackedUsed, source: 'tracked' };
  }

  return {
    trackedUsed: 0,
    effectiveUsed: Math.max(0, input.fallbackUsed),
    source: 'legacy',
  };
}

export async function buildUsageHealthReport(input: {
  supabase: SupabaseClient;
  userId: string;
  definitions: UsageMetricDefinitionRow[];
  effectiveLimits: Record<string, number>;
  usageByLimit: Record<string, Record<string, unknown>>;
}): Promise<UsageHealthMetricRow[]> {
  const { today, total } = await loadUsageCounterSnapshots(input.supabase, input.userId);

  const rows = await Promise.all(
    input.definitions.map(async (definition) => {
      const aliases = USAGE_METRIC_ALIASES[definition.metric_key] || [definition.metric_key];
      const limitKey = definition.limit_key || null;
      const limit = limitKey && Number.isFinite(Number(input.effectiveLimits[limitKey]))
        ? Number(input.effectiveLimits[limitKey])
        : null;
      const legacyEntry = limitKey ? (input.usageByLimit[limitKey] || {}) : {};
      const legacyUsed = limitKey ? Number(legacyEntry.used || 0) || 0 : readUsageMetricValue(total, aliases, 0);
      const limitMode = limitKey ? String((legacyEntry as any)?.mode || '').trim().toLowerCase() : '';
      const useTrackedForLimit = !limitKey || shouldUseTrackedCountersForRuleMode(limitMode);

      let trackedUsed = 0;
      let resetWindowStart: string | null = null;
      let resetWindowEnd: string | null = null;
      const todayWindowStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

      if (limitKey && input.usageByLimit[limitKey]?.reset) {
        resetWindowStart = String((input.usageByLimit[limitKey] as any)?.reset?.window_start || '') || null;
        resetWindowEnd = String((input.usageByLimit[limitKey] as any)?.reset?.window_end || '') || null;
        if (useTrackedForLimit && resetWindowStart === todayWindowStart) {
          trackedUsed = readUsageMetricValue(today, aliases, 0);
        } else if (useTrackedForLimit && !resetWindowEnd && resetWindowStart.startsWith('1970-01-01T00:00:00')) {
          trackedUsed = readUsageMetricValue(total, aliases, 0);
        }
      } else if (definition.reset_policy === 'daily') {
        trackedUsed = readUsageMetricValue(today, aliases, 0);
        resetWindowStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
        resetWindowEnd = null;
      } else if (definition.reset_policy === 'never') {
        trackedUsed = readUsageMetricValue(total, aliases, 0);
        resetWindowStart = '1970-01-01T00:00:00.000Z';
        resetWindowEnd = null;
      } else {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
        resetWindowStart = monthStart.toISOString();
        resetWindowEnd = monthEnd.toISOString();
      }

      if (useTrackedForLimit && trackedUsed === 0 && resetWindowStart) {
        const totals = await loadTrackedUsageWindowTotals({
          supabase: input.supabase,
          userId: input.userId,
          metricKeys: aliases,
          windowStart: resetWindowStart,
          windowEnd: resetWindowEnd,
        });
        trackedUsed = readUsageMetricValue(totals, aliases, trackedUsed);
      }

      let source: UsageHealthMetricRow['source'] = useTrackedForLimit ? 'tracked' : 'limit_snapshot';
      let effectiveUsed = useTrackedForLimit ? trackedUsed : legacyUsed;
      if (!useTrackedForLimit) {
        trackedUsed = 0;
      } else if (trackedUsed > 0 && legacyUsed > 0 && trackedUsed !== legacyUsed) {
        source = 'hybrid';
        effectiveUsed = Math.max(trackedUsed, legacyUsed);
      } else if (trackedUsed <= 0 && legacyUsed > 0) {
        source = 'legacy';
        effectiveUsed = legacyUsed;
      }

      return {
        metricKey: definition.metric_key,
        label: definition.label,
        unit: definition.unit,
        category: definition.category,
        limitKey,
        limit,
        trackedUsed,
        legacyUsed,
        effectiveUsed,
        source,
        resetPolicy: definition.reset_policy,
        resetWindowStart,
        resetWindowEnd,
        withinLimit: limit === null ? true : effectiveUsed <= limit,
      } satisfies UsageHealthMetricRow;
    }),
  );

  return rows.sort((a, b) => a.metricKey.localeCompare(b.metricKey));
}

export {
  TRACKED_USAGE_METRIC_KEYS,
  USAGE_METRIC_ALIASES,
  buildChatUsageIncrements,
  buildFeatureUsageIncrements,
  buildUploadUsageIncrements,
};
