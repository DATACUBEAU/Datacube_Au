import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { getBillingStatus } from '@/lib/server/billing';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createSupabaseAdminClient();
    const status = await getBillingStatus(supabase, auth.userId);
    return NextResponse.json(status, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'billing_status_failed', message: String(error?.message || 'Failed to load billing status.') },
      { status: 500 }
    );
  }
}

