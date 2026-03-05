import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { verifyCheckoutPayment } from '@/lib/server/billing';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const reference = String((body as any)?.reference || '').trim();
    if (!reference) {
      return NextResponse.json(
        { error: 'missing_reference', message: 'A payment reference is required.' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();
    const result = await verifyCheckoutPayment({
      supabase,
      userId: auth.userId,
      reference,
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
    return NextResponse.json(
      {
        error: 'verify_failed',
        message: String(error?.message || 'Payment verification failed.'),
      },
      { status: 400 }
    );
  }
}
