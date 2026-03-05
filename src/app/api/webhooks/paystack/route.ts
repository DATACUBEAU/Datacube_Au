import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { processPaystackWebhook } from '@/lib/server/billing';
import { verifyPaystackWebhookSignature } from '@/lib/server/paystack';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const traceId = randomUUID();
  try {
    const signature = req.headers.get('x-paystack-signature');
    const rawBody = await req.text();

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
