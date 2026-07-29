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
  reserveAiUsage,
  reserveFailureStatus,
} from '@/lib/server/ai-usage-accounting';

export const runtime = 'nodejs';

function reserveFailureMessage(code: string | null, status: string | null): string {
  if (code === 'USAGE_LIMIT_EXCEEDED') return 'AI usage limit reached for this account.';
  if (code === 'USAGE_RESERVATION_FINGERPRINT_MISMATCH') return 'This AI request idempotency key belongs to a different request.';
  if (status === 'committed' || status === 'released' || status === 'expired' || status === 'disputed') {
    return 'This AI request idempotency key is no longer active.';
  }
  return 'AI usage reservation failed.';
}

export async function POST(req: NextRequest) {
  const requestId = nanoid();
  try {
    const parsedBody = await req.json().catch(() => ({}));
    const body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
      ? (parsedBody as Record<string, unknown>)
      : {};
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

    const authorization = await requireEntitlement(req, operation.featureKey);
    const { auth, supabase } = authorization;
    
    // Validate limits
    const limitsResult = await resolveCanonicalEffectiveLimits({ supabase, userId: auth.userId });

    // Check specific limits based on feature
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

    // Sign the JWT ticket
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

    const vpsUrl = (process.env.VPS_AI_GATEWAY_URL || process.env.NEXT_PUBLIC_VPS_GATEWAY_URL || 'https://vps.datacube.au').replace(/\/+$/, '');

    return withNoStore(NextResponse.json(buildApiSuccessBody({ ticket: jwt, vpsUrl, idempotencyKey: reservation.idempotencyKey })));
  } catch (error: any) {
    if (isAccessControlError(error)) {
      return accessControlResponse(error, requestId);
    }
    console.error('[VPS Ticket Error]', {
      requestId,
      code: typeof error?.code === 'string' ? error.code : null,
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
    });
    const apiError = extractApiError(error);
    const status = Number.isFinite(Number(apiError.status)) && Number(apiError.status) >= 400
      ? Number(apiError.status)
      : 500;
    return withNoStore(
      NextResponse.json(
        buildApiErrorBody({
          status,
          code: status >= 500 ? 'VPS_TICKET_FAILED' : apiError.code,
          message: status >= 500 ? 'VPS ticket request failed.' : apiError.message,
          requestId,
          retryable: apiError.retryable,
        }),
        { status },
      ),
    );
  }
}
