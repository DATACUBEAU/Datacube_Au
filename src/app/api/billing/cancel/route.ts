import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { cancelUserSubscription } from '@/lib/server/billing';
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
    const reason = String((body as any)?.reason || '').trim();
    const supabase = createSupabaseAdminClient();
    const result = await cancelUserSubscription(supabase, auth.userId, { reason });
    return NextResponse.json({ status: 'ok', ...result }, { status: 200 });
  } catch (error: any) {
    const failure = serializeBillingApiError(error, {
      status: 500,
      code: 'cancel_failed',
      message: 'Failed to cancel subscription.',
      requestId,
    });
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
