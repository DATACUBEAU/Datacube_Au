import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { extractBillingReturnState } from '@/lib/billing/payment-return';
import { verifyCheckoutPayment } from '@/lib/server/billing';
import { serializeBillingApiError } from '@/lib/server/billing-config';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const bodyState = extractBillingReturnState(body as Record<string, unknown>);
    const queryState = extractBillingReturnState(req.nextUrl.searchParams);
    const reference = bodyState.reference || queryState.reference;
    const verificationTarget = bodyState.verificationTarget || queryState.verificationTarget;
    const gatewayHint = bodyState.gatewayHint || queryState.gatewayHint;
    if (!verificationTarget) {
      return NextResponse.json(
        { error: 'missing_reference', message: 'A payment reference is required.', requestId },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();
    const result = await verifyCheckoutPayment({
      supabase,
      userId: auth.userId,
      reference,
      verificationTarget,
      gatewayHint,
    });

    return NextResponse.json(
      {
        status: 'ok',
        success: result.success,
        gateway: result.gateway,
        reference: result.reference,
        payment_status: result.status,
        amount_kobo: result.amountKobo,
      },
      { status: 200 }
    );
  } catch (error: any) {
    const failure = serializeBillingApiError(error, {
      status: 500,
      code: 'verify_failed',
      message: 'Payment verification failed.',
      requestId,
    });
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
