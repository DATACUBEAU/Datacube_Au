import { NextRequest, NextResponse } from 'next/server';
import { getModelRoutingFlags } from '@/lib/server/ai-routing';
import {
  accessControlResponse,
  isAccessControlError,
  requireAdmin,
} from '@/lib/server/authorization';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin(req);

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
    if (isAccessControlError(error)) {
      return accessControlResponse(error);
    }
    return NextResponse.json(
      { error: 'model_routing_debug_failed', message: String(error?.message || 'Failed to load routing debug state.') },
      { status: 500 }
    );
  }
}
