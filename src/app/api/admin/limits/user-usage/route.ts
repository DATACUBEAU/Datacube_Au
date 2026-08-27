import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { resolveCanonicalEffectiveLimits } from '@/lib/server/au-limits';
import { APPROVED_LIMIT_KEYS, type ApprovedLimitKey } from '@/lib/limits/plan-limit-model';

export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const adjustmentSchema = z.object({
  userId: z.string().regex(UUID_REGEX, 'userId must be a valid UUID.'),
  action: z.enum(['increase', 'decrease', 'set', 'reset', 'reset_all']),
  metricKey: z.enum(APPROVED_LIMIT_KEYS).optional(),
  amount: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
  reason: z.string().trim().min(3).max(500),
  requestId: z.string().trim().min(8).max(200).optional(),
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function serializeUsage(effective: Awaited<ReturnType<typeof resolveCanonicalEffectiveLimits>>) {
  return APPROVED_LIMIT_KEYS.map((key) => {
    const rule = effective.limitRules[key];
    const usage = effective.usage.by_limit[key];
    return {
      key,
      label: rule.label,
      description: rule.description,
      unit: rule.unitLabel,
      category: rule.category,
      mode: rule.mode,
      used: usage.used,
      limit: usage.limit,
      remaining: usage.remaining,
      state: usage.state,
      adjustable: rule.mode === 'usage' && rule.isEnabled,
      reset: usage.reset,
    };
  });
}

async function applyAdjustment(input: {
  supabase: any;
  actorUserId: string;
  actorEmail: string | null;
  userId: string;
  metricKey: ApprovedLimitKey;
  action: 'increase' | 'decrease' | 'set' | 'reset';
  amount?: number;
  reason: string;
  requestId: string;
  effective: Awaited<ReturnType<typeof resolveCanonicalEffectiveLimits>>;
}) {
  const rule = input.effective.limitRules[input.metricKey];
  const usage = input.effective.usage.by_limit[input.metricKey];

  if (rule.mode !== 'usage' || !rule.isEnabled) {
    return {
      ok: false,
      code: 'metric_not_adjustable',
      message: `${rule.label} is ${rule.mode === 'usage' ? 'disabled' : 'a capacity/current-state limit'} and cannot be manually adjusted.`,
    } as const;
  }

  const current = Math.max(0, Number(usage.used || 0));
  const amount = Math.max(0, Number(input.amount || 0));
  let target = current;

  if (input.action === 'increase') target = current + amount;
  if (input.action === 'decrease') target = Math.max(0, current - amount);
  if (input.action === 'set') target = amount;
  if (input.action === 'reset') target = 0;

  const delta = target - current;
  if (delta === 0) {
    return { ok: true, changed: false, current, target, delta: 0 } as const;
  }

  const { data, error } = await input.supabase.rpc('admin_adjust_usage', {
    p_actor_user_id: input.actorUserId,
    p_actor_email: input.actorEmail,
    p_target_user_id: input.userId,
    p_metric_key: input.metricKey,
    p_delta: delta,
    p_action: input.action,
    p_window_start: usage.reset.window_start,
    p_window_end: usage.reset.window_end,
    p_reason: input.reason,
    p_request_id: input.requestId,
    p_context: {
      previous_usage: current,
      requested_target: target,
      effective_plan: input.effective.plan,
      source: 'conex-simple-usage-editor',
    },
  });

  if (error) throw error;
  return { ok: true, changed: true, current, target, delta, rpc: data } as const;
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const userId = String(req.nextUrl.searchParams.get('userId') || '').trim();
  if (!UUID_REGEX.test(userId)) {
    return json({ ok: false, code: 'invalid_user_id', message: 'Choose a valid user.', requestId }, 400);
  }

  try {
    const effective = await resolveCanonicalEffectiveLimits({ supabase: adminResult.supabase, userId });
    return json({
      ok: true,
      requestId,
      userId,
      plan: effective.plan,
      effectivePlan: effective.effectivePlan,
      resetAt: effective.usage.reset_at,
      usage: serializeUsage(effective),
    });
  } catch {
    return json({
      ok: false,
      code: 'user_usage_load_failed',
      message: 'Unable to load usage right now. Try again, and use the request ID if you need support.',
      requestId,
    }, 500);
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  try {
    const body = adjustmentSchema.parse(await req.json());
    const effective = await resolveCanonicalEffectiveLimits({
      supabase: adminResult.supabase,
      userId: body.userId,
    });
    const actorUserId = adminResult.auth.userId;
    const actorEmail = adminResult.auth.email ?? null;
    const rootRequestId = body.requestId || requestId;

    if (body.action === 'reset_all') {
      const results = [];
      for (const key of APPROVED_LIMIT_KEYS) {
        const rule = effective.limitRules[key];
        if (rule.mode !== 'usage' || !rule.isEnabled) continue;
        const result = await applyAdjustment({
          supabase: adminResult.supabase,
          actorUserId,
          actorEmail,
          userId: body.userId,
          metricKey: key,
          action: 'reset',
          reason: body.reason,
          requestId: `${rootRequestId}:${key}`,
          effective,
        });
        results.push({ key, ...result });
      }

      const refreshed = await resolveCanonicalEffectiveLimits({ supabase: adminResult.supabase, userId: body.userId });
      return json({
        ok: true,
        requestId,
        action: body.action,
        results,
        plan: refreshed.plan,
        usage: serializeUsage(refreshed),
      });
    }

    if (!body.metricKey) {
      return json({ ok: false, code: 'metric_required', message: 'Choose a usage item.', requestId }, 400);
    }
    if ((body.action === 'increase' || body.action === 'decrease' || body.action === 'set') && body.amount === undefined) {
      return json({ ok: false, code: 'amount_required', message: 'Enter an amount.', requestId }, 400);
    }

    const result = await applyAdjustment({
      supabase: adminResult.supabase,
      actorUserId,
      actorEmail,
      userId: body.userId,
      metricKey: body.metricKey,
      action: body.action,
      amount: body.amount,
      reason: body.reason,
      requestId: rootRequestId,
      effective,
    });

    if (!result.ok) return json({ ...result, requestId }, 400);

    const refreshed = await resolveCanonicalEffectiveLimits({ supabase: adminResult.supabase, userId: body.userId });
    return json({
      ok: true,
      requestId,
      action: body.action,
      metricKey: body.metricKey,
      result,
      plan: refreshed.plan,
      usage: serializeUsage(refreshed),
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return json({ ok: false, code: 'invalid_request', message: 'Check the usage action and try again.', details: error.flatten(), requestId }, 400);
    }
    return json({
      ok: false,
      code: 'user_usage_update_failed',
      message: 'Unable to update usage right now. Try again, and use the request ID if you need support.',
      requestId,
    }, 500);
  }
}
