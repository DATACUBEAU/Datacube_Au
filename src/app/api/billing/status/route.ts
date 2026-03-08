import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { getBillingStatus } from '@/lib/server/billing';
import { serializeBillingApiError } from '@/lib/server/billing-config';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
    }

    const supabase = createSupabaseAdminClient();
    const status = await getBillingStatus(supabase, auth.userId);
    return NextResponse.json(status, { status: 200 });
  } catch (error: any) {
    const failure = serializeBillingApiError(error, {
      status: 500,
      code: 'billing_status_failed',
      message: 'Failed to load billing status.',
      requestId,
    });
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
