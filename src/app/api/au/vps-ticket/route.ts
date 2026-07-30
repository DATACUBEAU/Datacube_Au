import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { resolveCanonicalEffectiveLimits, throwChatLimitIfNeeded, throwKnowledgeHubLimitIfNeeded, throwPracticeExamLimitIfNeeded, throwExamPredictionLimitIfNeeded } from '@/lib/server/au-limits';
import { buildApiErrorBody, buildApiSuccessBody, extractApiError } from '@/lib/api/api-contract';
import { nanoid } from 'nanoid';
import {
  accessControlResponse,
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
  | 'TICKET_USAGE_RESERVATION_FAILED'
  | 'TICKET_SIGNING_CONFIG_MISSING'
  | 'TICKET_GATEWAY_URL_MISSING'
  | 'TICKET_SHARED_SECRET_MISSING'
  | 'TICKET_CONTRACT_MISMATCH'
  | 'TICKET_DATABASE_ERROR'
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

type ReservedTicketUsage = {
  supabase: Awaited<ReturnType<typeof requireEntitlement>>['supabase'];
  userId: string;
  featureKey: string;
  route: string;
  idempotencyKey: string;
  ticketId: string;
  reservationId: string;
};

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

  if (code === 'VPS_SHARED_SECRET_MISSING') return 'TICKET_SHARED_SECRET_MISSING';
  if (code === 'INVALID_REQUEST_PAYLOAD') return 'TICKET_CONTRACT_MISMATCH';
  if (message.includes('missing supabase') || message.includes('service role') || message.includes('environment variable')) {
    return 'TICKET_DATABASE_ERROR';
  }

  if (stage === 'authorize_request') return isDatabaseLikeError(error) ? 'TICKET_DATABASE_ERROR' : 'TICKET_USER_VALIDATION_FAILED';
  if (stage === 'load_limits' || stage === 'check_limits') {
    return isDatabaseLikeError(error) ? 'TICKET_DATABASE_ERROR' : 'TICKET_ENTITLEMENT_LOOKUP_FAILED';
  }
  if (stage === 'resolve_signing_secret') return 'TICKET_SIGNING_CONFIG_MISSING';
  if (stage === 'reserve_usage') return 'TICKET_USAGE_RESERVATION_FAILED';
  if (stage === 'sign_ticket') return 'TICKET_UNKNOWN_SERVER_ERROR';
  if (stage === 'build_response') return 'TICKET_GATEWAY_URL_MISSING';
  if (stage === 'resolve_operation') return 'TICKET_CONTRACT_MISMATCH';
  return 'TICKET_UNKNOWN_SERVER_ERROR';
}

function ticketFailureMessage(code: TicketFailureCategory): string {
  if (code === 'TICKET_USAGE_RESERVATION_FAILED') return 'AI usage reservation failed.';
  if (code === 'TICKET_ENTITLEMENT_LOOKUP_FAILED') return 'AI entitlement check failed.';
  if (code === 'TICKET_USER_VALIDATION_FAILED') return 'Authentication could not be verified.';
  if (code === 'TICKET_SIGNING_CONFIG_MISSING' || code === 'TICKET_SHARED_SECRET_MISSING') {
    return 'AI gateway ticket signing is not configured.';
  }
  if (code === 'TICKET_GATEWAY_URL_MISSING') return 'AI gateway URL is not configured.';
  if (code === 'TICKET_CONTRACT_MISMATCH') return 'AI route contract mismatch.';
  if (code === 'TICKET_DATABASE_ERROR') return 'AI ticket database check failed.';
  return 'VPS ticket request failed.';
}

async function releaseReservationAfterTicketFailure(input: {
  usage: ReservedTicketUsage | null;
  failureCode: TicketFailureCategory;
  requestId: string;
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
        code: result.code,
        status: result.status,
      });
    }
  } catch (releaseError) {
    console.error('[VPS Ticket Usage Release Error]', {
      requestId: input.requestId,
      code: safeErrorCode(releaseError),
      status: safeErrorStatus(releaseError),
    });
  }
}

export async function POST(req: NextRequest) {
  const requestId = nanoid();
  let stage: TicketStage = 'parse_request';
  let reservedUsage: ReservedTicketUsage | null = null;
  try {
    stage = 'parse_request';
    const parsedBody = await req.json().catch(() => ({}));
    const body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
      ? (parsedBody as Record<string, unknown>)
      : {};
    stage = 'resolve_operation';
    const operation = resolveVpsTicketOperation(body.feature || 'chat');
    if (!operation) {
      return withNoStore(
        NextResponse.json(
          buildApiErrorBody({
            status: 400,
            code: 'INVALID_REQUEST_PAYLOAD',
            message: 'Unknown AI feature.',
            requestId,
          }),
          { status: 400 },
        ),
      );
    }

    stage = 'authorize_request';
    const authorization = await requireEntitlement(req, operation.featureKey);
    const { auth, supabase } = authorization;
    
    // Validate limits
    stage = 'load_limits';
    const limitsResult = await resolveCanonicalEffectiveLimits({ supabase, userId: auth.userId });

    // Check specific limits based on feature
    stage = 'check_limits';
    if (operation.featureKey === 'au_chat' || operation.featureKey === 'global_chat') {
      const chatUsage = buildAiUsageIncrements(operation, body);
      throwChatLimitIfNeeded({ limits: limitsResult, correlationId: requestId, tokenIncrement: chatUsage.estimatedTokens });
    } else if (operation.featureKey === 'knowledge_generation') {
      throwKnowledgeHubLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (operation.featureKey === 'practice_exam_generation') {
      throwPracticeExamLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (operation.featureKey === 'exam_predictions') {
      throwExamPredictionLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    }

    stage = 'resolve_signing_secret';
    const secretResolution = resolveVpsSharedSecretForSigning();
    if (!secretResolution.ok) {
      console.error('[VPS Ticket Config Error]', {
        code: secretResolution.code,
        requestId,
      });
      return withNoStore(
        NextResponse.json(
          buildApiErrorBody({
            status: secretResolution.status,
            code: secretResolution.code,
            message: secretResolution.message,
            requestId,
          }),
          { status: secretResolution.status },
        ),
      );
    }

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
      return withNoStore(
        NextResponse.json(
          buildApiErrorBody({
            status,
            code: reservation.code || 'AI_USAGE_RESERVATION_FAILED',
            message: reserveFailureMessage(reservation.code, reservation.status),
            requestId,
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

    stage = 'build_response';
    const vpsUrl = (process.env.VPS_AI_GATEWAY_URL || process.env.NEXT_PUBLIC_VPS_GATEWAY_URL || 'https://vps.datacube.au').replace(/\/+$/, '');

    return withNoStore(NextResponse.json(buildApiSuccessBody({ ticket: jwt, vpsUrl, idempotencyKey: reservation.idempotencyKey })));
  } catch (error: any) {
    if (isAccessControlError(error)) {
      return accessControlResponse(error, requestId);
    }
    const failureCode = classifyTicketFailure(stage, error);
    await releaseReservationAfterTicketFailure({ usage: reservedUsage, failureCode, requestId });
    console.error('[VPS Ticket Error]', {
      requestId,
      stage,
      code: failureCode,
      errorCode: safeErrorCode(error),
      status: safeErrorStatus(error),
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
          retryable: apiError.retryable,
        }),
        { status },
      ),
    );
  }
}
