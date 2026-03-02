import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createSupabaseAdminClient();
    const { data: profile } = await supabase
      .from('au_user_profiles')
      .select('tier')
      .eq('user_id', auth.userId)
      .maybeSingle();

    const allowed = hasConexAccess({
      userId: auth.userId,
      email: auth.email,
      tier: profile?.tier || null,
    });
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const [{ data: transactions }, { data: subscriptions }, { data: audit }] = await Promise.all([
      supabase
        .from('billing_transactions')
        .select('reference,status,amount_kobo,channel,paid_at,created_at,user_id')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('billing_subscriptions')
        .select('user_id,plan_key,status,starts_at,ends_at,cancel_at_period_end,updated_at')
        .order('updated_at', { ascending: false })
        .limit(30),
      supabase
        .from('entitlement_audit')
        .select('user_id,action,source,created_at,trace_id')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    return NextResponse.json(
      {
        transactions: transactions || [],
        subscriptions: subscriptions || [],
        entitlementAudit: audit || [],
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'billing_overview_failed', message: String(error?.message || 'Failed to load overview.') },
      { status: 500 }
    );
  }
}

