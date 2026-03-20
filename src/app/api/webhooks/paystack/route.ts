import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { processPaystackWebhook } from '@/lib/server/billing';
import { serializeBillingApiError } from '@/lib/server/billing-config';
import {
  consumeBillingRateLimit,
  resolveBillingRequestIp,
} from '@/lib/server/billing-request-guard';
import { verifyPaystackWebhookSignature } from '@/lib/server/paystack';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT_MAX_HITS = 80;
const WEBHOOK_MAX_BODY_BYTES = 256_000;

const PAYSTACK_EVENTS = new Set([
  'charge.success',
  'charge.failed',
  'transfer.failed',
  'bank.transfer.rejected',
  'subscription.create',
  'subscription.disable',
  'subscription.not_renew',
  'invoice.payment_failed',
  'invoice.update',
]);

function isValidPaystackPayload(payload: any): boolean {
  const event = String(payload?.event || '').trim();
  if (!PAYSTACK_EVENTS.has(event)) return false;
  const data = payload?.data || {};
  if (event.startsWith('charge.') || event.includes('transfer')) {
    return Boolean(String(data?.reference || data?.id || '').trim());
  }
  return Boolean(
    String(data?.customer?.email || '').trim() || String(data?.metadata?.user_id || '').trim(),
  );
}

export async function POST(req: NextRequest) {
  const traceId = randomUUID();
  try {
    const rateLimit = consumeBillingRateLimit({
      scope: 'paystack-webhook',
      key: resolveBillingRequestIp(req),
      maxHits: WEBHOOK_RATE_LIMIT_MAX_HITS,
      windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
    });
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: 'rate_limited', traceId },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      );
    }

    const signature = req.headers.get('x-paystack-signature');
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > WEBHOOK_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large', traceId }, { status: 413 });
    }

    if (!verifyPaystackWebhookSignature(rawBody, signature)) {
      return NextResponse.json(
        { error: 'invalid_signature', traceId },
        { status: 401 }
      );
    }

    let payload: any;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: 'invalid_json', traceId }, { status: 400 });
    }
    if (!isValidPaystackPayload(payload)) {
      return NextResponse.json({ error: 'invalid_payload', traceId }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const result = await processPaystackWebhook({
      supabase,
      payload,
      traceId,
    });

    return NextResponse.json(
      {
        ok: true,
        duplicate: result.duplicate,
        event: result.event,
        traceId,
      },
      { status: 200 }
    );
  } catch (error: any) {
    const failure = serializeBillingApiError(error, {
      status: 500,
      code: 'webhook_processing_failed',
      message: 'Webhook processing failed.',
      requestId: traceId,
    });
    return NextResponse.json(
      {
        ...failure.body,
        traceId,
      },
      { status: failure.status },
    );
  }
}
