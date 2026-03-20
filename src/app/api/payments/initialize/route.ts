import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createCheckout } from '@/lib/server/billing';
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

const CHECKOUT_RATE_LIMIT_WINDOW_MS = 60_000;
const CHECKOUT_RATE_LIMIT_MAX_HITS = 4;

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
          message: 'Refresh billing status before attempting another payment action.',
          requestId,
        },
        { status: 403 },
      );
    }

    const rateLimit = consumeBillingRateLimit({
      scope: 'billing-checkout',
      key: `${auth.userId}:${resolveBillingRequestIp(req)}`,
      maxHits: CHECKOUT_RATE_LIMIT_MAX_HITS,
      windowMs: CHECKOUT_RATE_LIMIT_WINDOW_MS,
    });
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'High demand / rate limited - retry shortly.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    const planKey = String((body as any)?.plan_key || '').trim();
    const paymentMethod = String((body as any)?.payment_method || '').trim().toLowerCase();
    if (planKey !== 'pro_weekly' && planKey !== 'pro_monthly') {
      throw new BillingApiError(400, 'invalid_plan_key', 'Invalid plan key.');
    }
    if (paymentMethod !== 'subscription' && paymentMethod !== 'transfer') {
      throw new BillingApiError(400, 'invalid_payment_method', 'Payment method must be subscription or transfer.');
    }

    idempotencyKey = normalizeBillingIdempotencyKey(req.headers.get('x-idempotency-key'));
    if (!idempotencyKey) {
      throw new BillingApiError(400, 'missing_idempotency_key', 'An idempotency key is required for checkout.');
    }
    requestHash = hashBillingRequestPayload({
      plan_key: planKey,
      payment_method: paymentMethod,
    });

    const existing = await readBillingRequestIdempotency({
      supabase,
      userId: auth.userId,
      feature: 'billing_checkout',
      idempotencyKey,
    });
    if (existing) {
      if (existing.request_hash && existing.request_hash !== requestHash) {
        throw new BillingApiError(
          409,
          'idempotency_conflict',
          'That checkout idempotency key was already used for a different request.',
        );
      }
      return NextResponse.json(existing.response_json, { status: Number(existing.status_code || 200) || 200 });
    }

    let email = auth.email;
    if (!email) {
      const userResult = await supabase.auth.admin.getUserById(auth.userId);
      if (userResult.error || !userResult.data?.user?.email) {
        return NextResponse.json(
          { error: 'missing_email', message: 'Unable to resolve account email for checkout.' },
          { status: 400 }
        );
      }
      email = userResult.data.user.email;
    }
    const checkoutEmail = String(email || '').trim();
    if (!checkoutEmail) {
      return NextResponse.json(
        { error: 'missing_email', message: 'Unable to resolve account email for checkout.' },
        { status: 400 }
      );
    }

    const result = await createCheckout({
      supabase,
      userId: auth.userId,
      email: checkoutEmail,
      planKeyRaw: planKey,
      paymentMethodRaw: paymentMethod,
      origin: req.nextUrl.origin,
    });

    const responseBody = {
      status: 'ok',
      authorization_url: result.authorizationUrl,
      reference: result.reference,
    };

    await writeBillingRequestIdempotency({
      supabase,
      userId: auth.userId,
      feature: 'billing_checkout',
      idempotencyKey,
      requestHash,
      responseJson: responseBody,
      statusCode: 200,
      requestId,
      ttlSeconds: 15 * 60,
    });

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error: any) {
    const failure = serializeBillingApiError(error, {
      status: 500,
      code: 'checkout_failed',
      message: 'Checkout failed.',
      requestId,
    });

    if (authUserId && idempotencyKey && requestHash && failure.status < 500) {
      await writeBillingRequestIdempotency({
        supabase,
        userId: authUserId,
        feature: 'billing_checkout',
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
