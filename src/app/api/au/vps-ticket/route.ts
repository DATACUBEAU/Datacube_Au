import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { resolveCanonicalEffectiveLimits, throwChatLimitIfNeeded, throwKnowledgeHubLimitIfNeeded, throwPracticeExamLimitIfNeeded, throwExamPredictionLimitIfNeeded } from '@/lib/server/au-limits';
import { buildApiErrorBody, buildApiSuccessBody, extractApiError } from '@/lib/api/api-contract';
import { trackUsageEvent, buildUsageEventKey } from '@/lib/server/usage-tracking';
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

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const requestId = nanoid();
  try {
    const body = await req.json().catch(() => ({}));
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
      throwChatLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
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

    // Pre-increment usage to ensure billing enforcement
    // Since VPS no longer increments, we do it here when issuing the ticket.
    await trackUsageEvent({
      supabase,
      userId: auth.userId,
      feature: operation.usageFeature,
      source: 'vps-ticket',
      eventKey: buildUsageEventKey({ feature: operation.usageFeature, requestId }),
      increments: { [operation.usageFeature]: 1 },
      requestId,
    }).catch(err => console.error('Failed to pre-increment usage', {
      requestId,
      feature: operation.usageFeature,
      message: err instanceof Error ? err.message : String(err),
    }));

    // Sign the JWT ticket
    const jwt = await new SignJWT({
        sub: auth.userId,
        plan: limitsResult.plan,
        feature: operation.requestFeature,
        feature_key: operation.featureKey,
        route: operation.gatewayRoute,
        ticket_id: requestId,
      })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('dcau-next')
      .setAudience('dcau-vps-ai-gateway')
      .setJti(requestId)
      .setIssuedAt()
      .setExpirationTime('5m') // 5 minutes validity to absorb skew and network latency
      .sign(secretResolution.secret);

    const vpsUrl = (process.env.VPS_AI_GATEWAY_URL || process.env.NEXT_PUBLIC_VPS_GATEWAY_URL || 'https://vps.datacube.au').replace(/\/+$/, '');

    return withNoStore(NextResponse.json(buildApiSuccessBody({ ticket: jwt, vpsUrl })));
  } catch (error: any) {
    if (isAccessControlError(error)) {
      return accessControlResponse(error, requestId);
    }
    console.error('[VPS Ticket Error]', error);
    const apiError = extractApiError(error);
    return withNoStore(NextResponse.json(buildApiErrorBody(apiError), { status: apiError.status || 500 }));
  }
}
