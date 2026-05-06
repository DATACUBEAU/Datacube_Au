import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { resolveCanonicalEffectiveLimits, throwChatLimitIfNeeded, throwKnowledgeHubLimitIfNeeded, throwPracticeExamLimitIfNeeded, throwExamPredictionLimitIfNeeded } from '@/lib/server/au-limits';
import { buildApiErrorBody, buildApiSuccessBody, extractApiError } from '@/lib/api/api-contract';
import { trackUsageEvent, buildUsageEventKey } from '@/lib/server/usage-tracking';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';

function getVpsSharedSecret(): Uint8Array {
  const secret = process.env.VPS_SHARED_SECRET || 'default-insecure-secret-for-dev-only-change-me-in-prod';
  return new TextEncoder().encode(secret);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok || !auth.userId) {
      return NextResponse.json(
        buildApiErrorBody({ code: 'UNAUTHORIZED', message: 'Missing or invalid authentication.' }),
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const feature = String(body.feature || 'chat').toLowerCase();
    
    // Validate limits
    const supabaseAdmin = createSupabaseAdminClient();
    const limitsResult = await resolveCanonicalEffectiveLimits({ supabase: supabaseAdmin, userId: auth.userId });
    
    const requestId = nanoid();

    // Check specific limits based on feature
    if (feature === 'chat' || feature === 'au-chat' || feature === 'global-chat') {
      throwChatLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (feature === 'generate-knowledge') {
      throwKnowledgeHubLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (feature === 'exam-generator' || feature === 'generate-practice-exam') {
      throwPracticeExamLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    } else if (feature === 'prediction-engine' || feature === 'generate-exam-predictions') {
      throwExamPredictionLimitIfNeeded({ limits: limitsResult, correlationId: requestId });
    }

    // Pre-increment usage to ensure billing enforcement
    // Since VPS no longer increments, we do it here when issuing the ticket.
    await trackUsageEvent({
      supabase: supabaseAdmin,
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
        plan: limitsResult.effectivePlan,
        feature,
      })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1m') // 60 seconds short-lived
      .sign(secret);

    const vpsUrl = process.env.VPS_AI_GATEWAY_URL || process.env.NEXT_PUBLIC_VPS_GATEWAY_URL || 'https://vps.datacube.au';

    return NextResponse.json(buildApiSuccessBody({ ticket: jwt, vpsUrl }));
  } catch (error: any) {
    console.error('[VPS Ticket Error]', error);
    const apiError = extractApiError(error);
    return NextResponse.json(buildApiErrorBody(apiError), { status: apiError.status || 500 });
  }
}
