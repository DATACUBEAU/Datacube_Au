import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { processFlutterwaveWebhook } from '@/lib/server/billing';
import {
  consumeBillingRateLimit,
  resolveBillingRequestIp,
} from '@/lib/server/billing-request-guard';
import { verifyFlutterwaveWebhookSignature } from '@/lib/payments/flutterwave';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT_MAX_HITS = 80;
const WEBHOOK_MAX_BODY_BYTES = 256_000;

function isValidFlutterwavePayload(payload: any): boolean {
  const data = payload?.data || {};
  return Boolean(String(data?.tx_ref || data?.reference || data?.id || '').trim());
}

export async function POST(req: NextRequest) {
  const traceId = randomUUID();
  try {
    const rateLimit = consumeBillingRateLimit({
      scope: 'flutterwave-webhook',
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

    const signature = req.headers.get('verif-hash') || req.headers.get('x-flutterwave-signature');
    let signatureValid = false;
    try {
      signatureValid = verifyFlutterwaveWebhookSignature(signature);
    } catch (error: any) {
      return NextResponse.json(
        {
          error: 'webhook_not_configured',
          message: String(error?.message || 'Flutterwave webhook is not configured.'),
          traceId,
        },
        { status: 500 }
      );
    }

    if (!signatureValid) {
      return NextResponse.json(
        { error: 'invalid_signature', traceId },
        { status: 401 }
      );
    }

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > WEBHOOK_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large', traceId }, { status: 413 });
    }
    let payload: any;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: 'invalid_json', traceId }, { status: 400 });
    }
    if (!isValidFlutterwavePayload(payload)) {
      return NextResponse.json({ error: 'invalid_payload', traceId }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const result = await processFlutterwaveWebhook({
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
    return NextResponse.json(
      {
        error: 'webhook_processing_failed',
        message: String(error?.message || 'Webhook processing failed.'),
        traceId,
      },
      { status: 500 }
    );
  }
}
