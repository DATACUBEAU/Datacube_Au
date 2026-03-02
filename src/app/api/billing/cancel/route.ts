import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { cancelUserSubscription } from '@/lib/server/billing';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createSupabaseAdminClient();
    await cancelUserSubscription(supabase, auth.userId);
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'cancel_failed', message: String(error?.message || 'Failed to cancel subscription.') },
      { status: 400 }
    );
  }
}

