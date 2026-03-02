import { NextRequest, NextResponse } from 'next/server';
import { reconcileBilling } from '@/lib/server/billing';
import { createSupabaseAdminClient, firstEnv } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const expected = firstEnv('BILLING_RECONCILE_SECRET', 'CRON_SECRET');
  if (!expected) return false;
  const headerToken = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(headerToken && headerToken === expected);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const summary = await reconcileBilling(supabase);
    return NextResponse.json({ ok: true, summary }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'reconcile_failed', message: String(error?.message || 'Reconciliation failed.') },
      { status: 500 }
    );
  }
}

