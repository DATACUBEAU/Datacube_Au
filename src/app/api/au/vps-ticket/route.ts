import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { resolveCanonicalEffectiveLimits, throwChatLimitIfNeeded, throwKnowledgeHubLimitIfNeeded, throwPracticeExamLimitIfNeeded, throwExamPredictionLimitIfNeeded } from '@/lib/server/au-limits';
import { buildApiErrorBody, buildApiSuccessBody, extractApiError } from '@/lib/api/api-contract';
import { nanoid } from 'nanoid';
import {
  isAccessControlError,
  requireEntitlement,
  withNoStore,
} from '@/lib/server/authorization';
import {
  resolveVpsSharedSecretForSigning,
  resolveVpsTicketOperation,
} from '@/lib/server/vps-ticket-config';
import {
  buildAiUsageIncrements,
  buildAiUsageReservationPayload,
  normalizeAiIdempotencyKey,
  releaseReservedAiUsage,
  reserveAiUsage,
  reserveFailureStatus,
} from '@/lib/server/ai-usage-accounting';

export const runtime = 'nodejs';

type TicketFailureCategory =
  | 'TICKET_USER_VALIDATION_FAILED'
  | 'TICKET_ENTITLEMENT_LOOKUP_FAILED'
  | 'TICKET_PLAN_LOOKUP_FAILED'
  | 'TICKET_USAGE_RESERVATION_FAILED'
  | 'TICKET_RESERVATION_RPC_MISSING'
  | 'TICKET_RESERVATION_RPC_SIGNATURE_MISMATCH'
  | 'TICKET_RESERVATION_PERMISSION_DENIED'
  | 'TICKET_SIGNING_SECRET_MISSING'
  | 'TICKET_SIGNING_FAILED'
  | 'TICKET_GATEWAY_URL_MISSING'
  | 'TICKET_CONTRACT_CONFIG_MISSING'
  | 'TICKET_DATABASE_ERROR'
  | 'TICKET_RUNTIME_CONFIGURATION_ERROR'
  | 'TICKET_UNKNOWN_SERVER_ERROR';

type TicketStage =
  | 'parse_request'
  | 'resolve_operation'
  | 'authorize_request'
  | 'load_limits'
  | 'check_limits'
  | 'resolve_signing_secret'
  | 'reserve_usage'
  | 'sign_ticket'
  | 'build_response';

type TicketStageStatus = 'start' | 'success' | 'failure';

type ReservedTicketUsage = {
  supabase: Awaited<ReturnType<typeof requireEntitlement>>['supabase'];
  userId: string;
  featureKey: string;
  route: string;
  idempotencyKey: string;
  ticketId: string;
  reservationId: string;
};

function safeOpaqueId(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (/^[A-Za-z0-9._:-]{6,160}$/.test(raw)) return raw.slice(0, 160);
  return fallback;
}

function logTicketStage(input: {
  requestId: string;
  correlationId: string;
  stage: TicketStage;
  status: TicketStageStatus;
  code?: string | null;
  httpStatus?: number | null;
  featureKey?: string | null;
  route?: string | null;
}): void {
  const payload = {
    requestId: input.requestId,
    correlationId: input.correlationId,
    stage: input.stage,
    status: input.status,
    ...(input.code ? { code: input.code } : {}),
    ...(input.httpStatus ? { httpStatus: input.httpStatus } : {}),
    ...(input.featureKey ? { featureKey: input.featureKey } : {}),
    ...(input.route ? { route: input.route } : {}),
  };

  if (input.status === 'failure') {
    console.error('[VPS Ticket Stage]', payload);
  } else {
    console.info('[VPS Ticket Stage]', payload);
  }
}

function reserveFailureMessage(code: string | null, status: string | null): string {
  if (code === 'USAGE_LIMIT_EXCEEDED') return 'AI usage limit reached for this account.';
  if (code === 'USAGE_RESERVATION_FINGERPRINT_MISMATCH') return 'This AI request idempotency key belongs to a different request.';
  if (status === 'committed' || status === 'released' || status === 'expired' || status === 'disputed') {
    return 'This AI request idempotency key is no longer active.';
  }
  return 'AI usage reservation failed.';
}

function safeErrorCode(error: unknown): string | null {
  const code = typeof (error as any)?.code === 'string' ? (error as any).code.trim() : '';
  return code ? code.slice(0, 80) : null;
}

function safeErrorStatus(error: unknown): number | null {
  const status = Number((error as any)?.status ?? (error as any)?.statusCode);
  return Number.isFinite(status) ? status : null;
}

function isDatabaseLikeError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    code.startsWith('PG') ||
    code.startsWith('PGRST') ||
    /^[0-9A-Z]{5}$/.test(code) ||
    message.includes('database') ||
    message.includes('relation') ||
    message.includes('column') ||
    message.includes('function') ||
    message.includes('schema cache')
  );
}

function classifyTicketFailure(stage: TicketStage, error: unknown): TicketFailureCategory {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();

  if (code === 'VPS_SHARED_SECRET_MISSING') return 'TICKET_SIGNING_SECRET_MISSING';
  if (code === 'INVALID_REQUEST_PAYLOAD') return 'TICKET_CONTRACT_CONFIG_MISSING';
  if (message.includes('missing supabase') || message.includes('service role') || message.includes('environment variable')) {
    return 'TICKET_RUNTIME_CONFIGURATION_ERROR';
  }

  if (stage === 'reserve_usage') {
    if (code === '42883') return 'TICKET_RESERVATION_RPC_SIGNATURE_MISMATCH';
    if (code === 'PGRST202' || (message.includes('function') && message.includes('does not exist'))) {
      return 'TICKET_RESERVATION_RPC_MISSING';
    }
    if (code === '42501' || message.includes('permission denied') || message.includes('service_role_required')) {
      return 'TICKET_RESERVATION_PERMISSION_DENIED';
    }
    return isDatabaseLikeError(error) ? 'TICKET_DATABASE_ERROR' : 'TICKET_USAGE_RESERVATION_FAILED';
  }

  if (stage === 'authorize_request') return isDatabaseLikeError(error) ? 'TICKET_DATABASE_ERROR' : 'TICKET_USER_VALIDATION_FAILED';
  if (stage === 'load_limits') return isDatabaseLikeError(error) ? 'TICKET_DATABASE_ERROR' : 'TICKET_ENTITLEMENT_LOOKUP_FAILED';
  if (stage === 'check_limits') return isDatabaseLikeError(error) ? 'TICKET_DATABASE_ERROR' : 'TICKET_PLAN_LOOKUP_FAILED';
  if (stage === 'resolve_signing_secret') return 'TICKET_SIGNING_SECRET_MISSING';
  if (stage === 'sign_ticket') return 'TICKET_SIGNING_FAILED';
  if (stage === 'build_response') return 'TICKET_GATEWAY_URL_MISSING';
  if (stage === 'resolve_operation') return 'TICKET_CONTRACT_CONFIG_MISSING';
  return 'TICKET_UNKNOWN_SERVER_ERROR';
}

function ticketFailureMessage(code: TicketFailureCategory): string {
  if (code === 'TICKET_USAGE_RESERVATION_FAILED') return 'AI usage reservation failed.';
  if (code === 'TICKET_RESERVATION_RPC_MISSING' || code === 'TICKET_RESERVATION_RPC_SIGNATURE_MISMATCH') {
    return 'AI usage reservation is not compatible with the database schema.';
  }
  if (code === 'TICKET_RESERVATION_PERMISSION_DENIED') return 'AI usage reservation is not authorized.';
  if (code === 'TICKET_ENTITLEMENT_LOOKUP_FAILED') return 'AI entitlement check failed.';
  if (code === 'TICKET_PLAN_LOOKUP_FAILED') return 'AI plan limit check failed.';
  if (code === 'TICKET_USER_VALIDATION_FAILED') return 'Authentication could not be verified.';
  if (code === 'TICKET_SIGNING_SECRET_MISSING') {
    return 'AI gateway ticket signing is not configured.';
  }
  if (code === 'TICKET_SIGNING_FAILED') return 'AI gateway ticket could not be signed.';
  if (code === 'TICKET_GATEWAY_URL_MISSING') return 'AI gateway URL is not configured.';
  if (code === 'TICKET_CONTRACT_CONFIG_MISSING') return 'AI route contract mismatch.';
  if (code === 'TICKET_RUNTIME_CONFIGURATION_ERROR') return 'AI ticket runtime configuration failed.';
  if (code === 'TICKET_DATABASE_ERROR') return 'AI ticket database check failed.';
  return 'VPS ticket request failed.';
}

async function releaseReservationAfterTicketFailure(input: {
  usage: ReservedTicketUsage | null;
  failureCode: TicketFailureCategory;
  requestId: string;
  correlationId: string;
}): Promise<void> {
  if (!input.usage) return;
  try {
    const result = await releaseReservedAiUsage({
      ...input.usage,
      failureCode: input.failureCode,
      status: 'released',
    });
    if (!result.ok) {
      console.warn('[VPS Ticket Usage Release Rejected]', {
        requestId: input.requestId,
        correlationId: input.correlationId,
        code: result.code,
        status: result.status,
      });
    }
  } catch (releaseError) {
    console.error('[VPS Ticket Usage Release Error]', {
      requestId: input.requestId,
      correlationId: input.correlationId,
      code: safeErrorCode(releaseError),
      status: safeErrorStatus(releaseError),
    });
  }
}

export async function POST(req: NextRequest) {
  const requestId = nanoid();
  let correlationId = safeOpaqueId(req.headers.get('x-correlation-id'), requestId);
  let stage: TicketStage = 'parse_request';
  let reservedUsage: ReservedTicketUsage | null = null;
  logTicketStage({ requestId, correlationId, stage, status: 'start' });
  try {
    stage = 'parse_request';
    const parsedBody = await req.json().catch(() => ({}));
    const body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
      ? (parsedBody as Record<string, unknown>)
      : {};
    correlationId = safeOpaqueId((body as any).correlationId || (body as any).correlation_id, correlationId);
    logTicketStage({ requestId, correlationId, stage, status: 'success' });

    stage = 'resolve_operation';
    const operation = resolveVpsTicketOperation(body.feature || 'chat');
    if (!operation) {
      logTicketStage({ requestId, correlationId, stage, status: 'failure', code: 'INVALID_REQUEST_PAYLOAD', httpStatus: 400 });
      return withNoStore(
        NextResponse.json(
          buildApiErrorBody({
            status: 400,
            code: 'INVALID_REQUEST_PAYLOAD',
            message: 'Unknown AI feature.',
            requestId,
            correlationId,
          }),
          { status: 400 },
        ),
      );
    }
    logTicketStage({
      requestId,
      correlationId,
      stage,
      status: 'success',
      featureKey: operation.featureKey,
      route: operation.gatewayRoute,
    });

    stage = 'authorize_request';
    const authorization = await requireEntitlement(req, operation.featureKey);
    const { auth, supabase } = authorization;
    logTicketStage({ requestId, correlationId, stage, status: 'success', featureKey: operation.featureKey, route: operation.gatewayRoute });
    
    // Validate limits
    stage = 'load_limits';
    const limitsResult = await resolveCanonicalEffectiveLimits({ supabase, userId: auth.userId });
    logTicketStage({ requestId, correlationId, stage, status: 'success', featureKey: operation.featureKey, route: operation.gatewayRoute });

    // Check specific limits based on feature
    stage = 'check_limits';
    if (operation.featureKey === 'au_chat' || operation.featureKey === 'global_chat') {
      const chatUsage = buildAiUsageIncrements(operation, body);
      throwChatLimitIfNeeded({ limits: limitsResult, correlationId, tokenIncrement: chatUsage.estimatedTokens });
    } else if (operation.featureKey === 'knowledge_generation') {
      throwKnowledgeHubLimitIfNeeded({ limits: limitsResult, correlationId });
    } else if (operation.featureKey === 'practice_exam_generation') {
      throwPracticeExamLimitIfNeeded({ limits: limitsResult, correlationId });
    } else if (operation.featureKey === 'exam_predictions') {
      throwExamPredictionLimitIfNeeded({ limits: limitsResult, correlationId });
    }
    logTicketStage({ requestId, correlationId, stage, status: 'success', featureKey: operation.featureKey, route: operation.gatewayRoute });

    stage = 'resolve_signing_secret';
    const secretResolution = resolveVpsSharedSecretForSigning();
    if (!secretResolution.ok) {
      logTicketStage({
        requestId,
        correlationId,
        stage,
        status: 'failure',
        code: secretResolution.code,
        httpStatus: secretResolution.status,
        featureKey: operation.featureKey,
        route: operation.gatewayRoute,
      });
      return withNoStore(
        NextResponse.json(
          buildApiErrorBody({
            status: secretResolution.status,
            code: secretResolution.code,
            message: secretResolution.message,
            requestId,
            correlationId,
          }),
          { status: secretResolution.status },
        ),
      );
    }
    logTicketStage({ requestId, correlationId, stage, status: 'success', featureKey: operation.featureKey, route: operation.gatewayRoute });

    stage = 'reserve_usage';
    const idempotencyKey = normalizeAiIdempotencyKey(
      req.headers.get('x-idempotency-key') || (body as any)?.idempotencyKey,
      operation.requestFeature.replace(/[^a-z0-9]+/gi, '_') || 'ai',
    );
    const usageReservationPayload = buildAiUsageReservationPayload({
      limits: limitsResult,
      operation,
      idempotencyKey,
      body,
    });
    const reservation = await reserveAiUsage({
      supabase,
      userId: auth.userId,
      featureKey: operation.featureKey,
      route: operation.gatewayRoute,
      idempotencyKey,
      ticketId: requestId,
      reservation: usageReservationPayload,
    });

    if (!reservation.ok || !reservation.reservationId) {
      const status = reserveFailureStatus(reservation.code, reservation.status);
      logTicketStage({
        requestId,
        correlationId,
        stage,
        status: 'failure',
        code: reservation.code || 'AI_USAGE_RESERVATION_FAILED',
        httpStatus: status,
        featureKey: operation.featureKey,
        route: operation.gatewayRoute,
      });
      return withNoStore(
        NextResponse.json(
          buildApiErrorBody({
            status,
            code: reservation.code || 'AI_USAGE_RESERVATION_FAILED',
            message: reserveFailureMessage(reservation.code, reservation.status),
            requestId,
            correlationId,
            retryable: status >= 500,
          }),
          { status },
        ),
      );
    }
    reservedUsage = {
      supabase,
      userId: auth.userId,
      featureKey: operation.featureKey,
      route: operation.gatewayRoute,
      idempotencyKey: reservation.idempotencyKey,
      ticketId: requestId,
      reservationId: reservation.reservationId,
    };
    logTicketStage({ requestId, correlationId, stage, status: 'success', featureKey: operation.featureKey, route: operation.gatewayRoute });

    // Sign the JWT ticket
    stage = 'sign_ticket';
    const jwt = await new SignJWT({
        sub: auth.userId,
        plan: limitsResult.plan,
        feature: operation.requestFeature,
        feature_key: operation.featureKey,
        route: operation.gatewayRoute,
        ticket_id: requestId,
        reservation_id: reservation.reservationId,
        idempotency_key: reservation.idempotencyKey,
      })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('dcau-next')
      .setAudience('dcau-vps-ai-gateway')
      .setJti(requestId)
      .setIssuedAt()
      .setExpirationTime('5m') // 5 minutes validity to absorb skew and network latency
      .sign(secretResolution.secret);
    logTicketStage({ requestId, correlationId, stage, status: 'success', featureKey: operation.featureKey, route: operation.gatewayRoute });

    stage = 'build_response';
    const vpsUrl = (process.env.VPS_AI_GATEWAY_URL || process.env.NEXT_PUBLIC_VPS_GATEWAY_URL || 'https://vps.datacube.au').replace(/\/+$/, '');
    logTicketStage({ requestId, correlationId, stage, status: 'success', featureKey: operation.featureKey, route: operation.gatewayRoute });

    return withNoStore(NextResponse.json(buildApiSuccessBody({ ticket: jwt, vpsUrl, idempotencyKey: reservation.idempotencyKey, requestId, correlationId })));
  } catch (error: any) {
    if (isAccessControlError(error)) {
      logTicketStage({ requestId, correlationId, stage, status: 'failure', code: error.decision.code, httpStatus: error.status });
      return withNoStore(
        NextResponse.json(
          buildApiErrorBody({
            status: error.status,
            code: error.decision.code || 'FORBIDDEN',
            message: error.decision.reason || 'Access denied.',
            requestId,
            correlationId,
            upgrade: error.decision.upgradeUrl ? { href: error.decision.upgradeUrl } : null,
            extra: {
              feature: error.decision.feature || null,
              routeId: error.decision.routeId || null,
            },
          }),
          { status: error.status },
        ),
      );
    }
    const failureCode = classifyTicketFailure(stage, error);
    await releaseReservationAfterTicketFailure({ usage: reservedUsage, failureCode, requestId, correlationId });
    logTicketStage({
      requestId,
      correlationId,
      stage,
      status: 'failure',
      code: failureCode,
      httpStatus: safeErrorStatus(error),
    });
    const apiError = extractApiError(error);
    const status = Number.isFinite(Number(apiError.status)) && Number(apiError.status) >= 400
      ? Number(apiError.status)
      : 500;
    return withNoStore(
      NextResponse.json(
        buildApiErrorBody({
          status,
          code: status >= 500 ? failureCode : apiError.code,
          message: status >= 500 ? ticketFailureMessage(failureCode) : apiError.message,
          requestId,
          correlationId,
          retryable: apiError.retryable,
        }),
        { status },
      ),
    );
  }
}
