import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { DEFAULT_PLAN_LIMITS, getEffectiveLimits } from '@/lib/server/au-limits';
import { getFeatureFlagsSnapshot } from '@/lib/server/feature-flags';
import { createSupabaseAdminClient, createSupabaseRlsClient, firstEnv } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const FLAG_DEFAULTS: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {
  'limits.alerts.enabled': { enabled: true, config: {} },
  'limits.alerts.thresholds': { enabled: true, config: { warn: [70, 90], block: [100] } },
  'limits.alerts.cooldown_minutes': { enabled: true, config: { minutes: 20 } },
  'limits.enforcement.enabled': { enabled: true, config: {} },
  'limits.ui.upsell.enabled': { enabled: true, config: {} },
  upload_100mb: { enabled: false, config: {} },
};

function withLegacyLimitAliases(limits: Record<string, number>): Record<string, number> {
  const next = { ...limits };
  if (typeof next.max_file_size_mb === 'number' && typeof next.max_file_mb !== 'number') {
    next.max_file_mb = next.max_file_size_mb;
  }
  if (typeof next.max_documents_total === 'number' && typeof next.max_docs_total !== 'number') {
    next.max_docs_total = next.max_documents_total;
  }
  if (typeof next.max_concurrent_jobs === 'number' && typeof next.max_jobs_concurrent !== 'number') {
    next.max_jobs_concurrent = next.max_concurrent_jobs;
  }
  return next;
}

async function readCompatFlags(
  supabase: ReturnType<typeof createSupabaseAdminClient> | ReturnType<typeof createSupabaseRlsClient> | null,
) {
  const defaults = { ...FLAG_DEFAULTS };
  if (!supabase) return defaults;

  const snapshot = await getFeatureFlagsSnapshot(supabase).catch(() => new Map());
  return Object.entries(defaults).reduce(
    (acc, [key, fallback]) => {
      const row = snapshot.get(key);
      acc[key] = {
        enabled: row?.enabled ?? fallback.enabled,
        config: row?.config ?? fallback.config,
      };
      return acc;
    },
    {} as Record<string, { enabled: boolean; config: Record<string, unknown> }>,
  );
}

function createCompatSupabaseClient(accessToken: string | null) {
  if (firstEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')) {
    return createSupabaseAdminClient();
  }
  if (accessToken) {
    return createSupabaseRlsClient(accessToken);
  }
  return null;
}

function buildGuestPayload(requestId: string, flags: Record<string, { enabled: boolean; config: Record<string, unknown> }>) {
  return {
    ok: true,
    requestId,
    authenticated: false,
    plan: 'free',
    limits: withLegacyLimitAliases({ ...DEFAULT_PLAN_LIMITS.free }),
    usage: { today: {}, total: {} },
    reset_at: null,
    flags,
    source: 'usage_status_compat_guest',
  };
}

async function handleUsageStatus(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireUserFromRequest(req);
  const supabase = createCompatSupabaseClient(auth.ok ? auth.accessToken : null);
  const flags = await readCompatFlags(supabase);

  if (!auth.ok || !supabase) {
    return NextResponse.json(buildGuestPayload(requestId, flags), {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const result = await getEffectiveLimits(supabase, auth.userId);
    return NextResponse.json(
      {
        ok: true,
        requestId,
        authenticated: true,
        plan: result.plan,
        limits: result.limits,
        usage: result.usage,
        reset_at: result.usage.reset_at,
        flags,
        source: result.effectivePlan.source,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: 'usage_status_compat_failed',
        message: String(error?.message || error),
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}

export async function GET(req: NextRequest) {
  return handleUsageStatus(req);
}

export async function POST(req: NextRequest) {
  return handleUsageStatus(req);
}
