import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { resolveCanonicalEffectiveLimits } from '@/lib/server/au-limits';
import { buildUsageHealthReport, loadUsageMetricDefinitions } from '@/lib/server/usage-tracking';

export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const userId = String(req.nextUrl.searchParams.get('userId') || '').trim();
  const auditLimitRaw = Number(req.nextUrl.searchParams.get('auditLimit') || 50);
  const auditLimit = Number.isFinite(auditLimitRaw) ? Math.min(200, Math.max(1, Math.floor(auditLimitRaw))) : 50;

  if (userId && !UUID_REGEX.test(userId)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_user_id',
        message: 'userId must be a valid UUID.',
        requestId,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = adminResult.supabase;
    const definitions = await loadUsageMetricDefinitions(supabase);
    const auditQuery = supabase
      .from('au_usage_events')
      .select('id,user_id,feature,source,event_key,request_id,correlation_id,metric_increments,context,occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(auditLimit);
    const auditRes = userId ? await auditQuery.eq('user_id', userId) : await auditQuery;

    if (auditRes.error) throw auditRes.error;

    let userHealth: Record<string, unknown> | null = null;
    if (userId) {
      const effective = await resolveCanonicalEffectiveLimits({
        supabase,
        userId,
      });
      const metrics = await buildUsageHealthReport({
        supabase,
        userId,
        definitions,
        effectiveLimits: effective.limits,
        usageByLimit: effective.usage.by_limit as Record<string, Record<string, unknown>>,
      });

      userHealth = {
        userId,
        plan: effective.plan,
        effectivePlan: effective.effectivePlan,
        resetAt: effective.usage.reset_at,
        metrics,
      };
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        definitions,
        userHealth,
        audit: auditRes.data || [],
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: 'limits_health_failed',
        message: String(error?.message || error),
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
