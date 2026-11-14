import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { getQuotaPolicy } from '../tier/policy';
import { computeResetWindow, getLimitCap, type ApprovedLimitKey } from '../limits/plan-limit-model';
import type { VpsTicketOperation } from './vps-ticket-config';
import { buildChatTrackingPayload, buildFeatureUsageIncrements } from './usage-tracking';
import { normalizeMetricIncrements } from '../../../shared/usage-metrics';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{12,160}$/;
const CHAT_MIN_RESERVED_TOKENS = 768;

export type AiUsageLimitCheck = {
  metric_key: string;
  cap: number | null;
  scope: 'canonical_plan' | 'tier_quota';
  counter_scope: 'today' | 'total' | 'window';
  window_start?: string | null;
  window_end?: string | null;
};

export type AiUsageReservationPayload = {
  estimatedUnits: number;
  increments: Record<string, number>;
  limitChecks: AiUsageLimitCheck[];
  requestFingerprint: string;
};

export type AiUsageLimitSource = {
  effectivePlan: {
    hasPro: boolean;
  };
  limitRules: Record<ApprovedLimitKey, Parameters<typeof getLimitCap>[0] & {
    resetPolicy?: string | null;
    resetIntervalValue?: number | null;
    resetIntervalUnit?: 'hour' | 'day' | 'week' | 'month' | null;
  }>;
};

export type AiUsageReservationResult = {
  ok: boolean;
  reservationId: string | null;
  idempotencyKey: string;
  status: string | null;
  code: string | null;
  limit?: number | null;
  current?: number | null;
  requested?: number | null;
};

export type AiUsageReleaseResult = {
  ok: boolean;
  code: string | null;
  status: string | null;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => safeString(entry)).filter(Boolean).slice(0, 20);
}

export function normalizeAiIdempotencyKey(raw: unknown, prefix = 'ai'): string {
  const candidate = safeString(raw);
  if (IDEMPOTENCY_KEY_PATTERN.test(candidate)) return candidate;
  return '';
}

export function buildAiRequestFingerprint(input: {
  operation: VpsTicketOperation;
  idempotencyKey: string;
  body: Record<string, unknown>;
}): string {
  const body = input.body || {};
  const safePayload = {
    feature: input.operation.requestFeature,
    featureKey: input.operation.featureKey,
    route: input.operation.gatewayRoute,
    idempotencyKey: input.idempotencyKey,
    documentId: safeString((body as any).documentId || (body as any).doc_id || (body as any).selectedDocId),
    activeDocIds: safeStringList((body as any).activeDocIds),
    pastQuestionCount: Array.isArray((body as any).pastQuestionIds) ? Math.min((body as any).pastQuestionIds.length, 20) : 0,
    messageCount: Array.isArray((body as any).messages) ? Math.min((body as any).messages.length, 50) : 0,
    hasUserMessage: Boolean(safeString((body as any).message || (body as any).user_input || (body as any).question)),
    stream: (body as any).stream === true,
  };

  return createHash('sha256').update(stableStringify(safePayload)).digest('hex');
}

function addCanonicalCheck(
  checks: AiUsageLimitCheck[],
  limits: AiUsageLimitSource,
  key: ApprovedLimitKey,
  increments: Record<string, number>,
): void {
  if (Number(increments[key] || 0) <= 0) return;
  const rule = limits.limitRules[key];
  const cap = getLimitCap(rule);
  if (cap === null) return;
  const resetPolicy = String(rule.resetPolicy || 'never').trim().toLowerCase();
  const reset = computeResetWindow({
    resetPolicy: resetPolicy as any,
    resetIntervalValue: rule.resetIntervalValue ?? null,
    resetIntervalUnit: rule.resetIntervalUnit ?? null,
  });
  checks.push({
    metric_key: key,
    cap,
    scope: 'canonical_plan',
    counter_scope: resetPolicy === 'daily' ? 'today' : resetPolicy === 'never' ? 'total' : 'window',
    window_start: reset.windowStart,
    window_end: reset.windowEnd,
  });
}

export function buildAiUsageIncrements(operation: VpsTicketOperation, body: Record<string, unknown>): {
  estimatedTokens: number;
  increments: Record<string, number>;
} {
  if (operation.featureKey === 'au_chat' || operation.featureKey === 'global_chat') {
    const chat = buildChatTrackingPayload({
      messages: Array.isArray((body as any).messages) ? ((body as any).messages as any[]) : undefined,
      auGuide: (body as any).auGuide,
      activeDocIds: Array.isArray((body as any).activeDocIds) ? ((body as any).activeDocIds as string[]) : null,
      sessionId: safeString((body as any).sessionId),
      appContext: (body as any).appContext || (body as any).app_context,
      memoryPack: (body as any).memoryPack || (body as any).memory_pack,
      documentContext: (body as any).documentContext || (body as any).document_context,
      recentSnippet: (body as any).recentSnippet || (body as any).recent_snippet,
      secondarySnippet: (body as any).secondarySnippet || (body as any).secondary_snippet,
    });
    const reservedTokens = Math.max(CHAT_MIN_RESERVED_TOKENS, chat.estimatedTokens);
    return {
      estimatedTokens: reservedTokens,
      increments: {
        ...chat.increments,
        max_tokens_total: reservedTokens,
        used_tokens: reservedTokens,
        tokens_used: reservedTokens,
      },
    };
  }

  if (operation.featureKey === 'knowledge_generation') {
    return { estimatedTokens: 1, increments: buildFeatureUsageIncrements('knowledge_hub') };
  }

  if (operation.featureKey === 'practice_exam_generation') {
    return { estimatedTokens: 1, increments: buildFeatureUsageIncrements('practice_exam_generation') };
  }

  if (operation.featureKey === 'exam_predictions') {
    return { estimatedTokens: 1, increments: buildFeatureUsageIncrements('exam_prediction') };
  }

  if (operation.featureKey === 'prompt_starters') {
    return {
      estimatedTokens: 1,
      increments: normalizeMetricIncrements({
        prompt_starters_per_day: 1,
        api_calls: 1,
      }),
    };
  }

  return {
    estimatedTokens: 1,
    increments: normalizeMetricIncrements({ api_calls: 1 }),
  };
}

export function buildAiUsageLimitChecks(input: {
  limits: AiUsageLimitSource;
  operation: VpsTicketOperation;
  increments: Record<string, number>;
}): AiUsageLimitCheck[] {
  const checks: AiUsageLimitCheck[] = [];
  const { limits, operation, increments } = input;

  if (operation.featureKey === 'au_chat' || operation.featureKey === 'global_chat') {
    addCanonicalCheck(checks, limits, 'max_chats_total', increments);
    addCanonicalCheck(checks, limits, 'max_tokens_total', increments);
  } else if (operation.featureKey === 'knowledge_generation') {
    addCanonicalCheck(checks, limits, 'max_knowledge_hub', increments);
  } else if (operation.featureKey === 'practice_exam_generation') {
    addCanonicalCheck(checks, limits, 'max_practice_exams', increments);
  } else if (operation.featureKey === 'exam_predictions') {
    addCanonicalCheck(checks, limits, 'max_exam_predictions', increments);
  } else if (operation.featureKey === 'prompt_starters') {
    const quota = getQuotaPolicy('prompt_starters_per_day');
    const cap = limits.effectivePlan.hasPro ? quota?.proLimit : quota?.freeLimit;
    if (typeof cap === 'number' && Number.isFinite(cap)) {
      const reset = computeResetWindow({
        resetPolicy: 'daily',
        resetIntervalValue: null,
        resetIntervalUnit: null,
      });
      checks.push({
        metric_key: 'prompt_starters_per_day',
        cap: Math.max(0, Math.floor(cap)),
        scope: 'tier_quota',
        counter_scope: 'today',
        window_start: reset.windowStart,
        window_end: reset.windowEnd,
      });
    }
  }

  return checks;
}

export function buildAiUsageReservationPayload(input: {
  limits: AiUsageLimitSource;
  operation: VpsTicketOperation;
  idempotencyKey: string;
  body: Record<string, unknown>;
}): AiUsageReservationPayload {
  const usage = buildAiUsageIncrements(input.operation, input.body);
  const increments = normalizeMetricIncrements(usage.increments);
  return {
    estimatedUnits: Math.max(1, Math.floor(usage.estimatedTokens || 1)),
    increments,
    limitChecks: buildAiUsageLimitChecks({
      limits: input.limits,
      operation: input.operation,
      increments,
    }),
    requestFingerprint: buildAiRequestFingerprint({
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      body: input.body,
    }),
  };
}

function normalizeReservationResult(data: unknown, fallbackIdempotencyKey: string): AiUsageReservationResult {
  const payload = (data || {}) as Record<string, unknown>;
  return {
    ok: payload.ok === true,
    reservationId: typeof payload.reservation_id === 'string' ? payload.reservation_id : null,
    idempotencyKey: typeof payload.idempotency_key === 'string' ? payload.idempotency_key : fallbackIdempotencyKey,
    status: typeof payload.status === 'string' ? payload.status : null,
    code: typeof payload.code === 'string' ? payload.code : null,
    limit: typeof payload.limit === 'number' ? payload.limit : null,
    current: typeof payload.current === 'number' ? payload.current : null,
    requested: typeof payload.requested === 'number' ? payload.requested : null,
  };
}

export async function reserveAiUsage(input: {
  supabase: SupabaseClient;
  userId: string;
  featureKey: string;
  route: string;
  idempotencyKey: string;
  ticketId: string;
  reservation: AiUsageReservationPayload;
  expiresAt?: string | null;
}): Promise<AiUsageReservationResult> {
  const increments = normalizeMetricIncrements(input.reservation.increments);
  if (!input.userId || !input.featureKey || !input.route || !input.idempotencyKey || Object.keys(increments).length === 0) {
    return {
      ok: false,
      reservationId: null,
      idempotencyKey: input.idempotencyKey,
      status: null,
      code: 'INVALID_USAGE_RESERVATION',
    };
  }

  const { data, error } = await input.supabase.rpc('reserve_ai_usage', {
    p_user_id: input.userId,
    p_feature_key: input.featureKey,
    p_route: input.route,
    p_idempotency_key: input.idempotencyKey,
    p_request_fingerprint: input.reservation.requestFingerprint,
    p_metric_increments: increments,
    p_limit_checks: input.reservation.limitChecks,
    p_estimated_units: input.reservation.estimatedUnits,
    p_ticket_id: input.ticketId,
    p_expires_at: input.expiresAt || null,
  });

  if (error) throw error;
  return normalizeReservationResult(data, input.idempotencyKey);
}

export async function releaseReservedAiUsage(input: {
  supabase: SupabaseClient;
  userId: string;
  featureKey: string;
  route: string;
  idempotencyKey: string;
  ticketId: string;
  reservationId: string;
  failureCode: string;
  status?: 'released' | 'disputed';
}): Promise<AiUsageReleaseResult> {
  const { data, error } = await input.supabase.rpc('release_ai_usage', {
    p_reservation_id: input.reservationId,
    p_user_id: input.userId,
    p_feature_key: input.featureKey,
    p_route: input.route,
    p_idempotency_key: input.idempotencyKey,
    p_ticket_id: input.ticketId,
    p_failure_code: input.failureCode,
    p_status: input.status || 'released',
  });

  if (error) throw error;
  const payload = (data || {}) as Record<string, unknown>;
  return {
    ok: payload.ok === true,
    code: typeof payload.code === 'string' ? payload.code : null,
    status: typeof payload.status === 'string' ? payload.status : null,
  };
}

export function reserveFailureStatus(code: string | null | undefined, status: string | null | undefined): number {
  const normalizedCode = String(code || '').toUpperCase();
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedCode === 'USAGE_LIMIT_EXCEEDED') return 429;
  if (normalizedCode === 'USAGE_RESERVATION_FINGERPRINT_MISMATCH') return 409;
  if (normalizedStatus === 'committed' || normalizedStatus === 'released' || normalizedStatus === 'expired' || normalizedStatus === 'disputed') {
    return 409;
  }
  if (normalizedCode.includes('INVALID')) return 400;
  return 503;
}
