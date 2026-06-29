import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { APPROVED_LIMIT_KEYS } from '@/lib/limits/plan-limit-model';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { serializeEffectivePlanLimitRule } from '@/lib/server/au-limits';
import { resolveCanonicalAccountSnapshot } from '@/lib/server/account-snapshot';

export const runtime = 'nodejs';

const SUCCESS_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache, max-age=0, must-revalidate',
  Vary: 'Authorization, Cookie',
};

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
    const responseBody = {
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
    };
    const responseText = JSON.stringify(responseBody);
    const responseBytes = new TextEncoder().encode(responseText).byteLength;
    return new NextResponse(
      responseText,
      {
        status: 200,
        headers: {
          ...SUCCESS_CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-DCAU-Snapshot-Bytes': String(responseBytes),
        },
      },
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
