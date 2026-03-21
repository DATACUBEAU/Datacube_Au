import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { APPROVED_LIMIT_KEYS } from '@/lib/limits/plan-limit-model';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { serializeEffectivePlanLimitRule } from '@/lib/server/au-limits';
import {
  resolveCanonicalAccountPlanAuthority,
  serializeCanonicalPlanSummary,
} from '@/lib/server/account-plan-authority';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: 'unauthorized',
        message: 'Sign in required.',
        requestId,
        details: { 
          reason: auth.reason,
          debug: auth.debug,
          env: process.env.VERCEL ? 'vercel' : 'local' 
        },
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const authority = await resolveCanonicalAccountPlanAuthority({
      supabase,
      userId: auth.userId,
    });
    const result = authority.limits;
    return NextResponse.json(
      {
        ok: true,
        requestId,
        plan: result.plan,
        account: serializeCanonicalPlanSummary({ authority }),
        limits: result.limits,
        limit_rules: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
          acc[key] = serializeEffectivePlanLimitRule(result.limitRules[key]);
          return acc;
        }, {} as Record<string, ReturnType<typeof serializeEffectivePlanLimitRule>>),
        usage: result.usage,
        reset_at: result.usage.reset_at,
        reset_policies: result.usage.reset_policies,
        usage_windows: result.usage.windows,
        source: result.effectivePlan.source,
        validatedAt: authority.validatedAt,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: 'limits_fetch_failed',
        message: String(error?.message || error),
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
