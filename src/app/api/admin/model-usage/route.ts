import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';

export const runtime = 'nodejs';

type UsageRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  feature: string;
  provider: string | null;
  model: string | null;
  model_id?: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  success: boolean | null;
  latency_ms: number | null;
  request_id: string | null;
  correlation_id: string | null;
  error: string | null;
  metadata: Record<string, any> | null;
};

function toBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50;
  const now = new Date();
  const last30dIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = adminResult.supabase;

    const [
      recentUsageRes,
      totalCountRes,
      successCountRes,
      failedCountRes,
      users30dRes,
      cacheRowsRes,
    ] = await Promise.all([
      supabase
        .from('au_model_usage')
        .select(
          'id,created_at,user_id,feature,provider,model,model_id,prompt_tokens,completion_tokens,total_tokens,cost_usd,success,latency_ms,request_id,correlation_id,error,metadata',
        )
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase.from('au_model_usage').select('id', { count: 'exact', head: true }),
      supabase.from('au_model_usage').select('id', { count: 'exact', head: true }).eq('success', true),
      supabase.from('au_model_usage').select('id', { count: 'exact', head: true }).eq('success', false),
      supabase
        .from('au_model_usage')
        .select('user_id')
        .gte('created_at', last30dIso)
        .not('user_id', 'is', null)
        .limit(10000),
      supabase
        .from('au_model_usage')
        .select('feature,total_tokens,metadata')
        .gte('created_at', last30dIso)
        .limit(10000),
    ]);

    const anyError =
      recentUsageRes.error ||
      totalCountRes.error ||
      successCountRes.error ||
      failedCountRes.error ||
      users30dRes.error ||
      cacheRowsRes.error;
    if (anyError) {
      return NextResponse.json(
        { error: 'usage_fetch_failed', message: anyError.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const usageRows = (recentUsageRes.data || []) as UsageRow[];
    const totalCalls = Number(totalCountRes.count || 0);
    const successfulCalls = Number(successCountRes.count || 0);
    const failedCalls = Number(failedCountRes.count || 0);
    const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;
    const totalUsers = new Set(
      (users30dRes.data || [])
        .map((row: any) => (typeof row?.user_id === 'string' ? row.user_id : ''))
        .filter(Boolean),
    ).size;

    const byFeatureMap = new Map<
      string,
      { calls: number; cacheHits: number; totalTokens: number; savedTokensEstimate: number }
    >();
    for (const row of cacheRowsRes.data || []) {
      const feature = String((row as any)?.feature || 'unknown').trim() || 'unknown';
      const metadata = ((row as any)?.metadata || {}) as Record<string, unknown>;
      const cacheHit = toBool((metadata as any)?.cache_hit);
      const tokens = Number((row as any)?.total_tokens || 0) || 0;
      const savedTokens = Number((metadata as any)?.saved_tokens || 0) || (cacheHit ? tokens : 0);
      const existing = byFeatureMap.get(feature) || {
        calls: 0,
        cacheHits: 0,
        totalTokens: 0,
        savedTokensEstimate: 0,
      };
      existing.calls += 1;
      if (cacheHit) existing.cacheHits += 1;
      existing.totalTokens += tokens;
      existing.savedTokensEstimate += Math.max(0, savedTokens);
      byFeatureMap.set(feature, existing);
    }

    const byFeature = Array.from(byFeatureMap.entries())
      .map(([feature, stats]) => ({
        feature,
        calls: stats.calls,
        cacheHits: stats.cacheHits,
        cacheHitRate: stats.calls > 0 ? stats.cacheHits / stats.calls : 0,
        savedTokensEstimate: stats.savedTokensEstimate,
      }))
      .sort((a, b) => b.calls - a.calls);

    const totalCacheCalls = byFeature.reduce((sum, row) => sum + row.calls, 0);
    const totalCacheHits = byFeature.reduce((sum, row) => sum + row.cacheHits, 0);
    const totalSavedTokensEstimate = byFeature.reduce((sum, row) => sum + row.savedTokensEstimate, 0);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        usageSource: 'au_model_usage',
        usage: usageRows.map((row) => ({
          ...row,
          model_id: row.model_id || row.model || 'unknown',
          provider: row.provider || 'unknown',
          model: row.model || row.model_id || 'unknown',
          success: row.success !== false,
          cache_hit: toBool((row.metadata || {})?.cache_hit),
        })),
        stats: {
          totalCalls,
          successfulCalls,
          failedCalls,
          successRate,
          totalUsers,
        },
        cacheMetrics: {
          overallHitRate: totalCacheCalls > 0 ? totalCacheHits / totalCacheCalls : 0,
          totalCacheHits,
          totalCacheCalls,
          totalSavedTokensEstimate,
          byFeature,
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

