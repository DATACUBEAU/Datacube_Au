import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { resumeUserSubscription } from '@/lib/server/billing';
import { serializeBillingApiError } from '@/lib/server/billing-config';
import {
  consumeBillingRateLimit,
  resolveBillingRequestIp,
} from '@/lib/server/billing-request-guard';
import { readBillingActionSignature } from '@/lib/server/billing-session';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const RESUBSCRIBE_RATE_LIMIT_WINDOW_MS = 60_000;
const RESUBSCRIBE_RATE_LIMIT_MAX_HITS = 3;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
    }

    const signature = readBillingActionSignature({
      req,
      userId: auth.userId,
    });
    if (!signature.valid) {
      return NextResponse.json(
        {
          error: 'invalid_billing_signature',
          message: 'Refresh billing status before restoring auto-renew.',
          requestId,
        },
        { status: 403 },
      );
    }

    const rateLimit = consumeBillingRateLimit({
      scope: 'billing-resubscribe',
      key: `${auth.userId}:${resolveBillingRequestIp(req)}`,
      maxHits: RESUBSCRIBE_RATE_LIMIT_MAX_HITS,
      windowMs: RESUBSCRIBE_RATE_LIMIT_WINDOW_MS,
    });
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many restore requests. Retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    const supabase = createSupabaseAdminClient();
    const result = await resumeUserSubscription(supabase, auth.userId);
    return NextResponse.json({ status: 'ok', ...result }, { status: 200 });
  } catch (error: any) {
    const failure = serializeBillingApiError(error, {
      status: 500,
      code: 'resubscribe_failed',
      message: 'Failed to restore auto-renew.',
      requestId,
    });
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
