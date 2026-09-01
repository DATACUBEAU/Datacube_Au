import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import { resolveCanonicalEffectiveLimits } from '@/lib/server/au-limits';
import { APPROVED_LIMIT_KEYS, type ApprovedLimitKey } from '@/lib/limits/plan-limit-model';

export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_USAGE_ADJUSTMENT_REQUEST_ID_LENGTH = 200;

const adjustmentSchema = z.object({
  userId: z.string().regex(UUID_REGEX, 'userId must be a valid UUID.'),
  action: z.enum(['increase', 'decrease', 'set', 'reset', 'reset_all']),
  metricKey: z.enum(APPROVED_LIMIT_KEYS).optional(),
  amount: z.coerce.number().finite().int().min(0).max(1_000_000_000).optional(),
  reason: z.string().trim().min(3).max(500),
  requestId: z.string().trim().min(8).max(MAX_USAGE_ADJUSTMENT_REQUEST_ID_LENGTH).optional(),
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function scopedUsageAdjustmentRequestId(rootRequestId: string, metricKey: ApprovedLimitKey) {
  const suffix = `:${metricKey}`;
  const availableRootLength = MAX_USAGE_ADJUSTMENT_REQUEST_ID_LENGTH - suffix.length;
  if (rootRequestId.length <= availableRootLength) return `${rootRequestId}${suffix}`;

  const digest = createHash('sha256').update(rootRequestId).digest('hex').slice(0, 16);
  const digestMarker = `:${digest}`;
  const prefixLength = Math.max(0, availableRootLength - digestMarker.length);
  return `${rootRequestId.slice(0, prefixLength)}${digestMarker}${suffix}`;
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

function sameResetWindow(
  left: { window_start: string | null; window_end: string | null },
  right: { window_start: string | null; window_end: string | null },
) {
  return left.window_start === right.window_start && left.window_end === right.window_end;
}

async function loadAdjustmentTotal(input: {
  supabase: any;
  userId: string;
  metricKey: ApprovedLimitKey;
  windowStart: string | null;
  windowEnd: string | null;
}) {
  if (!input.windowStart) return 0;
  const { data, error } = await input.supabase.rpc('get_usage_admin_adjustment_total', {
    p_user_id: input.userId,
    p_metric_key: input.metricKey,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
  });
  if (error) throw error;
  const parsed = Number(data ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadUsageMutationVersion(input: { supabase: any; userId: string }) {
  const { data, error } = await input.supabase.rpc('get_usage_mutation_version', {
    p_user_id: input.userId,
  });
  if (error) throw error;
  const parsed = Number(data ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('invalid_usage_mutation_version');
  }
  return parsed;
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
  expectedAdjustmentTotal: number;
  expectedUsageVersion: number;
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
  // A zero decrease is state-dependent: replaying it after new usage accrues could
  // otherwise acquire a new negative effect. Persist it through the authoritative
  // RPC as a no-op receipt. A zero increase is state-independent and can return
  // immediately because the same payload can never affect later usage.
  if (delta === 0 && input.action === 'increase') {
    return { ok: true, changed: false, current, target, delta: 0 } as const;
  }

  const { data, error } = await input.supabase.rpc('admin_adjust_usage_versioned', {
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
    p_expected_adjustment_total: input.expectedAdjustmentTotal,
    p_expected_usage_version: input.expectedUsageVersion,
    p_context: {
      previous_usage: current,
      requested_target: target,
      effective_plan: input.effective.plan,
      source: 'conex-simple-usage-editor',
    },
  });

  if (error) throw error;
  return { ok: true, changed: delta !== 0, current, target, delta, rpc: data } as const;
}

function isUsageConflict(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const code = String(candidate?.code || '');
  const message = `${String(candidate?.message || '')} ${String(candidate?.details || '')}`.toLowerCase();
  return code === '40001' || message.includes('usage_adjustment_conflict') || message.includes('usage_mutation_conflict');
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
    const initialEffective = await resolveCanonicalEffectiveLimits({
      supabase: adminResult.supabase,
      userId: body.userId,
    });
    const actorUserId = adminResult.auth.userId;
    const actorEmail = adminResult.auth.email ?? null;
    const rootRequestId = body.requestId || requestId;

    if (body.action === 'reset_all') {
      const adjustableKeys = APPROVED_LIMIT_KEYS.filter((key) => {
        const rule = initialEffective.limitRules[key];
        return rule.mode === 'usage' && rule.isEnabled;
      });

      const expectedTotals = Object.fromEntries(await Promise.all(adjustableKeys.map(async (key) => {
        const reset = initialEffective.usage.by_limit[key].reset;
        const total = await loadAdjustmentTotal({
          supabase: adminResult.supabase,
          userId: body.userId,
          metricKey: key,
          windowStart: reset.window_start,
          windowEnd: reset.window_end,
        });
        return [key, total] as const;
      }))) as Partial<Record<ApprovedLimitKey, number>>;
      const expectedUsageVersion = await loadUsageMutationVersion({
        supabase: adminResult.supabase,
        userId: body.userId,
      });

      const mutationEffective = await resolveCanonicalEffectiveLimits({
        supabase: adminResult.supabase,
        userId: body.userId,
      });

      const items = adjustableKeys.map((key) => {
        const beforeReset = initialEffective.usage.by_limit[key].reset;
        const usage = mutationEffective.usage.by_limit[key];
        if (!sameResetWindow(beforeReset, usage.reset)) {
          throw Object.assign(new Error('usage_adjustment_conflict'), { code: '40001' });
        }
        const current = Math.max(0, Number(usage.used || 0));
        return {
          metricKey: key,
          delta: -current,
          action: 'reset',
          windowStart: usage.reset.window_start,
          windowEnd: usage.reset.window_end,
          requestId: scopedUsageAdjustmentRequestId(rootRequestId, key),
          expectedAdjustmentTotal: expectedTotals[key] ?? 0,
          context: {
            previous_usage: current,
            requested_target: 0,
            effective_plan: mutationEffective.plan,
            source: 'conex-simple-usage-editor-reset-all',
          },
        };
      });

      if (items.length > 0) {
        const { error } = await adminResult.supabase.rpc('admin_adjust_usage_batch_versioned', {
          p_actor_user_id: actorUserId,
          p_actor_email: actorEmail,
          p_target_user_id: body.userId,
          p_reason: body.reason,
          p_expected_usage_version: expectedUsageVersion,
          p_items: items,
        });
        if (error) throw error;
      }

      const refreshed = await resolveCanonicalEffectiveLimits({ supabase: adminResult.supabase, userId: body.userId });
      return json({
        ok: true,
        requestId,
        action: body.action,
        results: items.map((item) => ({ key: item.metricKey, changed: item.delta !== 0, delta: item.delta })),
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

    const initialRule = initialEffective.limitRules[body.metricKey];
    if (initialRule.mode !== 'usage' || !initialRule.isEnabled) {
      return json({
        ok: false,
        code: 'metric_not_adjustable',
        message: `${initialRule.label} is ${initialRule.mode === 'usage' ? 'disabled' : 'a capacity/current-state limit'} and cannot be manually adjusted.`,
        requestId,
      }, 400);
    }

    const initialReset = initialEffective.usage.by_limit[body.metricKey].reset;
    const expectedAdjustmentTotal = await loadAdjustmentTotal({
      supabase: adminResult.supabase,
      userId: body.userId,
      metricKey: body.metricKey,
      windowStart: initialReset.window_start,
      windowEnd: initialReset.window_end,
    });
    const expectedUsageVersion = await loadUsageMutationVersion({
      supabase: adminResult.supabase,
      userId: body.userId,
    });
    const mutationEffective = await resolveCanonicalEffectiveLimits({
      supabase: adminResult.supabase,
      userId: body.userId,
    });
    if (!sameResetWindow(initialReset, mutationEffective.usage.by_limit[body.metricKey].reset)) {
      return json({
        ok: false,
        code: 'usage_changed',
        message: 'Usage changed while this action was being prepared. Refresh and try again.',
        requestId,
      }, 409);
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
      expectedAdjustmentTotal,
      expectedUsageVersion,
      effective: mutationEffective,
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
    if (isUsageConflict(error)) {
      return json({
        ok: false,
        code: 'usage_changed',
        message: 'Usage changed while this action was being prepared. Refresh and try again.',
        requestId,
      }, 409);
    }
    return json({
      ok: false,
      code: 'user_usage_update_failed',
      message: 'Unable to update usage right now. Try again, and use the request ID if you need support.',
      requestId,
    }, 500);
  }
}
