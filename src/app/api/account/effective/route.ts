import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { APPROVED_LIMIT_KEYS } from '@/lib/limits/plan-limit-model';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { serializeEffectivePlanLimitRule } from '@/lib/server/au-limits';
import { resolveCanonicalAccountSnapshot } from '@/lib/server/account-snapshot';

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
        details: { reason: auth.reason },
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const snapshot = await resolveCanonicalAccountSnapshot(supabase, auth.userId);
    return NextResponse.json(
      {
        ok: true,
        requestId,
        snapshot: {
          userId: snapshot.userId,
          validatedAt: snapshot.validatedAt,
          plan: snapshot.plan,
          effectivePlan: snapshot.effectivePlan,
          entitlements: snapshot.entitlements,
          currentPlan: snapshot.currentPlan,
          planSnapshot: snapshot.planSnapshot,
          limits: snapshot.limits,
          limitRules: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
            acc[key] = serializeEffectivePlanLimitRule(snapshot.limitRules[key]);
            return acc;
          }, {} as Record<string, ReturnType<typeof serializeEffectivePlanLimitRule>>),
          usage: snapshot.usage,
          subscription: snapshot.subscription,
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: 'account_snapshot_failed',
        message: String(error?.message || error),
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
