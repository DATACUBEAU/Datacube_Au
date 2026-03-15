import { NextRequest, NextResponse } from 'next/server';
import { APPROVED_LIMIT_KEYS, DEFAULT_PLAN_ORDER, type EffectivePlanCode } from '@/lib/limits/plan-limit-model';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  buildUsageSnapshotForUser,
  buildZeroUsageSnapshot,
  loadPublicPlanCatalog,
  serializeEffectivePlanLimitRule,
} from '@/lib/server/au-limits';

export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlan(value: string): value is EffectivePlanCode {
  return DEFAULT_PLAN_ORDER.includes(value as EffectivePlanCode);
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const plan = String(req.nextUrl.searchParams.get('plan') || 'free').trim().toLowerCase();
  if (!isPlan(plan)) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: 'invalid_plan',
        message: 'plan must be one of: free, pro, premium.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const rawUserId = String(req.nextUrl.searchParams.get('user_id') || '').trim();

  try {
    const supabase = adminResult.supabase;
    const planCatalog = await loadPublicPlanCatalog(supabase);
    const policy = planCatalog.find((entry) => entry.plan === plan);

    if (!policy) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          code: 'plan_policy_missing',
          message: `No plan policy found for ${plan}.`,
        },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    let previewUserId: string | null = null;
    let userFound = false;
    if (rawUserId && UUID_REGEX.test(rawUserId)) {
      const userRes = await supabase.auth.admin.getUserById(rawUserId);
      if (!userRes.error && userRes.data.user) {
        previewUserId = rawUserId;
        userFound = true;
      }
    }

    const usage = previewUserId
      ? await buildUsageSnapshotForUser(supabase, previewUserId, policy.limitRules)
      : buildZeroUsageSnapshot(policy.limitRules);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        plan,
        user_id: previewUserId,
        user_found: userFound,
        planPolicy: {
          plan: policy.plan,
          label: policy.metadata.label,
          description: policy.metadata.description,
          limits: policy.limits,
          limit_rules: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
            acc[key] = serializeEffectivePlanLimitRule(policy.limitRules[key]);
            return acc;
          }, {} as Record<string, ReturnType<typeof serializeEffectivePlanLimitRule>>),
          resetLabels: policy.resetLabels,
        },
        effectiveLimits: policy.limits,
        effectiveLimitRules: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
          acc[key] = serializeEffectivePlanLimitRule(policy.limitRules[key]);
          return acc;
        }, {} as Record<string, ReturnType<typeof serializeEffectivePlanLimitRule>>),
        usage,
        resetWindows: usage.windows,
        labels: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
          acc[key] = usage.windows[key]?.label || policy.resetLabels[key];
          return acc;
        }, {} as Record<string, string>),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: 'limits_preview_failed',
        message: String(error?.message || error),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
