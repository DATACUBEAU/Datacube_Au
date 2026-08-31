import type { SupabaseClient } from '@supabase/supabase-js';
import { errorLogDetails, logger } from './utils.js';

export type UsageReservationContext = {
  userId: string;
  featureKey: string;
  route: string;
  ticketId: string;
  reservationId: string;
  idempotencyKey: string;
};

export type UsageAccountingResult = {
  ok: boolean;
  code: string | null;
  status: string | null;
};

export class UsageAccountingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message = 'AI usage accounting failed',
  ) {
    super(message);
    this.name = 'UsageAccountingError';
  }
}

function headerString(headers: Record<string, unknown>, key: string): string {
  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function normalizeRpcResult(data: unknown): UsageAccountingResult {
  const payload = (data || {}) as Record<string, unknown>;
  return {
    ok: payload.ok === true,
    code: typeof payload.code === 'string' ? payload.code : null,
    status: typeof payload.status === 'string' ? payload.status : null,
  };
}

function accountingStatus(code: string | null, status: string | null): number {
  if (code === 'USAGE_REQUEST_IN_PROGRESS') return 409;
  if (code === 'USAGE_RESERVATION_CLAIM_MISMATCH') return 401;
  if (code === 'USAGE_RESERVATION_NOT_FOUND') return 401;
  if (status === 'committed' || status === 'released' || status === 'expired' || status === 'disputed') return 409;
  return 503;
}

export function usageReservationFromHeaders(headers: Record<string, unknown>): UsageReservationContext | null {
  const context = {
    userId: headerString(headers, 'x-user-id'),
    featureKey: headerString(headers, 'x-user-feature-key'),
    route: headerString(headers, 'x-user-route'),
    ticketId: headerString(headers, 'x-ticket-id'),
    reservationId: headerString(headers, 'x-usage-reservation-id'),
    idempotencyKey: headerString(headers, 'x-usage-idempotency-key'),
  };

  if (!context.userId || !context.featureKey || !context.route || !context.ticketId || !context.reservationId || !context.idempotencyKey) {
    return null;
  }

  return context;
}

export async function beginUsageReservation(input: {
  supabase: SupabaseClient;
  context: UsageReservationContext;
  provider?: string | null;
  model?: string | null;
}): Promise<void> {
  const { data, error } = await input.supabase.rpc('begin_ai_usage_reservation', {
    p_reservation_id: input.context.reservationId,
    p_user_id: input.context.userId,
    p_feature_key: input.context.featureKey,
    p_route: input.context.route,
    p_idempotency_key: input.context.idempotencyKey,
    p_ticket_id: input.context.ticketId,
    p_provider: input.provider || null,
    p_model: input.model || null,
  });

  if (error) {
    throw new UsageAccountingError(503, 'USAGE_BEGIN_FAILED');
  }

  const result = normalizeRpcResult(data);
  if (!result.ok) {
    const rejectionCode = result.code
      ? `USAGE_BEGIN_${result.code}`
      : 'USAGE_BEGIN_REJECTED';
    throw new UsageAccountingError(
      accountingStatus(result.code, result.status),
      rejectionCode,
      'AI usage reservation is not active',
    );
  }
}

export async function commitUsageReservation(input: {
  supabase: SupabaseClient;
  context: UsageReservationContext;
  provider?: string | null;
  model?: string | null;
}): Promise<void> {
  const { data, error } = await input.supabase.rpc('commit_ai_usage', {
    p_reservation_id: input.context.reservationId,
    p_user_id: input.context.userId,
    p_feature_key: input.context.featureKey,
    p_route: input.context.route,
    p_idempotency_key: input.context.idempotencyKey,
    p_ticket_id: input.context.ticketId,
    p_provider: input.provider || null,
    p_model: input.model || null,
  });

  if (error) {
    throw new UsageAccountingError(503, 'USAGE_COMMIT_FAILED');
  }

  const result = normalizeRpcResult(data);
  if (!result.ok) {
    throw new UsageAccountingError(
      accountingStatus(result.code, result.status),
      result.code || 'USAGE_COMMIT_REJECTED',
      'AI usage reservation could not be committed',
    );
  }
}

export async function releaseUsageReservation(input: {
  supabase: SupabaseClient;
  context: UsageReservationContext;
  failureCode: string;
  status?: 'released' | 'disputed';
}): Promise<void> {
  const { data, error } = await input.supabase.rpc('release_ai_usage', {
    p_reservation_id: input.context.reservationId,
    p_user_id: input.context.userId,
    p_feature_key: input.context.featureKey,
    p_route: input.context.route,
    p_idempotency_key: input.context.idempotencyKey,
    p_ticket_id: input.context.ticketId,
    p_failure_code: input.failureCode,
    p_status: input.status || 'released',
  });

  if (error) {
    throw new UsageAccountingError(503, 'USAGE_RELEASE_FAILED');
  }

  const result = normalizeRpcResult(data);
  if (!result.ok) {
    throw new UsageAccountingError(
      accountingStatus(result.code, result.status),
      result.code || 'USAGE_RELEASE_REJECTED',
      'AI usage reservation could not be released',
    );
  }
}

export async function safeReleaseUsageReservation(input: {
  supabase: SupabaseClient;
  context: UsageReservationContext | null;
  failureCode: string;
  status?: 'released' | 'disputed';
}): Promise<void> {
  if (!input.context) return;
  try {
    await releaseUsageReservation({
      supabase: input.supabase,
      context: input.context,
      failureCode: input.failureCode,
      status: input.status,
    });
  } catch (error) {
    logger.error('Usage reservation release failed', errorLogDetails(error));
  }
}
