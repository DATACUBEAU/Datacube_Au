import { NextRequest, NextResponse } from 'next/server';
import { APPROVED_LIMIT_KEYS, DEFAULT_PLAN_ORDER, type EffectivePlanCode } from '@/lib/limits/plan-limit-model';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  loadPlanMetadata,
  resolveCanonicalEffectiveLimits,
  serializeEffectivePlanLimitRuleMap,
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
    let previewUserId: string | null = null;
    let userFound = false;
    if (rawUserId && UUID_REGEX.test(rawUserId)) {
      const userRes = await supabase.auth.admin.getUserById(rawUserId);
      if (!userRes.error && userRes.data.user) {
        previewUserId = rawUserId;
        userFound = true;
      }
    }

    const [metadata, resolved] = await Promise.all([
      loadPlanMetadata(supabase, plan),
      resolveCanonicalEffectiveLimits({
        supabase,
        planOverride: plan,
        userId: previewUserId,
      }),
    ]);

    console.info('[limits-preview] resolved canonical snapshot', {
      requestId,
      plan,
      userId: previewUserId,
      userFound,
      limits: resolved.limits,
    });

    const serializedRules = serializeEffectivePlanLimitRuleMap(resolved.limitRules);
    const resetLabels = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
      acc[key] = resolved.usage.windows[key]?.label || serializedRules[key].presentation.reset_label;
      return acc;
    }, {} as Record<string, string>);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        plan,
        user_id: previewUserId,
        user_found: userFound,
        planPolicy: {
          plan: resolved.plan,
          label: metadata.label,
          description: metadata.description,
          limits: resolved.limits,
          limit_rules: serializedRules,
          resetLabels: resetLabels,
        },
        effectiveLimits: resolved.limits,
        effectiveLimitRules: serializedRules,
        usage: resolved.usage,
        resetWindows: resolved.usage.windows,
        labels: resetLabels,
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
