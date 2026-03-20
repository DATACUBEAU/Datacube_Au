import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { extractBillingReturnState } from '@/lib/billing/payment-return';
import { verifyCheckoutPayment } from '@/lib/server/billing';
import { BillingApiError, serializeBillingApiError } from '@/lib/server/billing-config';
import {
  consumeBillingRateLimit,
  hashBillingRequestPayload,
  normalizeBillingIdempotencyKey,
  readBillingRequestIdempotency,
  resolveBillingRequestIp,
  writeBillingRequestIdempotency,
} from '@/lib/server/billing-request-guard';
import { readBillingActionSignature } from '@/lib/server/billing-session';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const VERIFY_RATE_LIMIT_WINDOW_MS = 60_000;
const VERIFY_RATE_LIMIT_MAX_HITS = 8;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const supabase = createSupabaseAdminClient();
  let idempotencyKey = '';
  let requestHash = '';
  let authUserId = '';

  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
    }
    authUserId = auth.userId;

    const signature = readBillingActionSignature({
      req,
      userId: auth.userId,
    });
    if (!signature.valid) {
      return NextResponse.json(
        {
          error: 'invalid_billing_signature',
          message: 'Refresh billing status before verifying another payment.',
          requestId,
        },
        { status: 403 },
      );
    }

    const rateLimit = consumeBillingRateLimit({
      scope: 'billing-verify',
      key: `${auth.userId}:${resolveBillingRequestIp(req)}`,
      maxHits: VERIFY_RATE_LIMIT_MAX_HITS,
      windowMs: VERIFY_RATE_LIMIT_WINDOW_MS,
    });
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many verification attempts. Retry shortly.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    const bodyState = extractBillingReturnState(body as Record<string, unknown>);
    const queryState = extractBillingReturnState(req.nextUrl.searchParams);
    const reference = bodyState.reference || queryState.reference;
    const verificationTarget = bodyState.verificationTarget || queryState.verificationTarget;
    const gatewayHint = bodyState.gatewayHint || queryState.gatewayHint;
    if (!verificationTarget) {
      throw new BillingApiError(400, 'missing_reference', 'A payment reference is required.');
    }

    idempotencyKey = normalizeBillingIdempotencyKey(req.headers.get('x-idempotency-key'));
    if (!idempotencyKey) {
      throw new BillingApiError(400, 'missing_idempotency_key', 'An idempotency key is required for payment verification.');
    }
    requestHash = hashBillingRequestPayload({
      reference: reference || null,
      verification_target: verificationTarget,
      gateway: gatewayHint || null,
    });

    const existing = await readBillingRequestIdempotency({
      supabase,
      userId: auth.userId,
      feature: 'billing_verify',
      idempotencyKey,
    });
    if (existing) {
      if (existing.request_hash && existing.request_hash !== requestHash) {
        throw new BillingApiError(
          409,
          'idempotency_conflict',
          'That verification idempotency key was already used for a different request.',
        );
      }
      return NextResponse.json(existing.response_json, { status: Number(existing.status_code || 200) || 200 });
    }

    const result = await verifyCheckoutPayment({
      supabase,
      userId: auth.userId,
      reference,
      verificationTarget,
      gatewayHint,
    });

    const responseBody = {
      status: 'ok',
      success: result.success,
      gateway: result.gateway,
      reference: result.reference,
      payment_status: result.status,
      amount_kobo: result.amountKobo,
    };

    await writeBillingRequestIdempotency({
      supabase,
      userId: auth.userId,
      feature: 'billing_verify',
      idempotencyKey,
      requestHash,
      responseJson: responseBody,
      statusCode: 200,
      requestId,
      ttlSeconds: 10 * 60,
    });

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error: any) {
    const failure = serializeBillingApiError(error, {
      status: 500,
      code: 'verify_failed',
      message: 'Payment verification failed.',
      requestId,
    });

    if (authUserId && idempotencyKey && requestHash && failure.status < 500) {
      await writeBillingRequestIdempotency({
        supabase,
        userId: authUserId,
        feature: 'billing_verify',
        idempotencyKey,
        requestHash,
        responseJson: failure.body,
        statusCode: failure.status,
        requestId,
        ttlSeconds: 5 * 60,
      }).catch(() => undefined);
    }

    return NextResponse.json(failure.body, { status: failure.status });
  }
}
