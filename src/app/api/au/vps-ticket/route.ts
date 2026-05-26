import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { resolveCanonicalEffectiveLimits, throwChatLimitIfNeeded, throwKnowledgeHubLimitIfNeeded, throwPracticeExamLimitIfNeeded, throwExamPredictionLimitIfNeeded } from '@/lib/server/au-limits';
import { buildApiErrorBody, buildApiSuccessBody, extractApiError } from '@/lib/api/api-contract';
import { trackUsageEvent, buildUsageEventKey } from '@/lib/server/usage-tracking';
import { nanoid } from 'nanoid';
import { featureFromVpsTicketRequest } from '@/lib/authz/access-control';
import {
  accessControlResponse,
  isAccessControlError,
  requireEntitlement,
  withNoStore,
} from '@/lib/server/authorization';

export const runtime = 'nodejs';

function getVpsSharedSecret(): Uint8Array {
  const secret = process.env.VPS_SHARED_SECRET || 'default-insecure-secret-for-dev-only-change-me-in-prod';
  return new TextEncoder().encode(secret);
}

export async function POST(req: NextRequest) {
  const requestId = nanoid();
  try {
    const body = await req.json().catch(() => ({}));
    const feature = String(body.feature || 'chat').toLowerCase();
    const featureKey = featureFromVpsTicketRequest(feature);
    if (!featureKey) {
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

    const authorization = await requireEntitlement(req, featureKey);
    const { auth, supabase } = authorization;
    
    // Validate limits
    const limitsResult = await resolveCanonicalEffectiveLimits({ supabase, userId: auth.userId });

    // Check specific limits based on feature
    if (featureKey === 'au_chat' || featureKey === 'global_chat') {
      throwChatLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (featureKey === 'knowledge_generation') {
      throwKnowledgeHubLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (featureKey === 'practice_exam_generation') {
      throwPracticeExamLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (featureKey === 'exam_predictions') {
      throwExamPredictionLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    }

    // Pre-increment usage to ensure billing enforcement
    // Since VPS no longer increments, we do it here when issuing the ticket.
    await trackUsageEvent({
      supabase,
      userId: auth.userId,
      feature,
      source: 'vps-ticket',
      eventKey: buildUsageEventKey({ feature, requestId }),
      increments: { [feature]: 1 },
      requestId,
    }).catch(err => console.error('Failed to pre-increment usage', err));

    // Sign the JWT ticket
    const secret = getVpsSharedSecret();
    const jwt = await new SignJWT({ 
        sub: auth.userId, 
        plan: limitsResult.plan,
        feature,
        feature_key: featureKey,
      })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m') // 5 minutes validity to absorb skew and network latency
      .sign(secret);

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
