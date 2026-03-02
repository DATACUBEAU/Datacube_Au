import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { hasConexAccess } from '@/lib/conex-rbac';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getModelRoutingFlags } from '@/lib/server/ai-routing';

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

    const flags = await getModelRoutingFlags(supabase);
    const { data: latest } = await supabase
      .from('ai_routing_audit')
      .select('created_at,request_type,tier_wanted,service,model,plan')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json(
      {
        flags,
        latest: latest || null,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'model_routing_debug_failed', message: String(error?.message || 'Failed to load routing debug state.') },
      { status: 500 }
    );
  }
}

