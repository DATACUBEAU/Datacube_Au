import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { processFlutterwaveWebhook } from '@/lib/server/billing';
import { verifyFlutterwaveWebhookSignature } from '@/lib/payments/flutterwave';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const traceId = randomUUID();
  try {
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
    let payload: any;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: 'invalid_json', traceId }, { status: 400 });
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
