import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  APPROVED_LIMIT_KEYS,
  DEFAULT_PLAN_ORDER,
  PLAN_LIMIT_RESET_POLICY_VALUES,
  type ApprovedLimitKey,
  type EffectivePlanCode,
  type StoredPlanLimitRule,
} from '@/lib/limits/plan-limit-model';
import {
  loadAdminPlanLimitState,
  savePlanLimitScopeRules,
} from '@/lib/server/au-limits';

export const runtime = 'nodejs';

const simpleResetPolicies = ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'] as const;

const requestSchema = z.object({
  plan: z.enum(DEFAULT_PLAN_ORDER),
  metricKey: z.enum(APPROVED_LIMIT_KEYS),
  limit: z.coerce.number().int().min(0).max(1_000_000_000),
  resetPolicy: z.enum(simpleResetPolicies),
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function toStoredRule(rule: {
  key: ApprovedLimitKey;
  value: number | null;
  mode: StoredPlanLimitRule['mode'];
  resetPolicy: StoredPlanLimitRule['resetPolicy'];
  resetIntervalValue: number | null;
  resetIntervalUnit: StoredPlanLimitRule['resetIntervalUnit'];
  isEnabled: boolean;
  isUnlimited: boolean;
  updatedAt: string | null;
}): StoredPlanLimitRule {
  return {
    key: rule.key,
    value: rule.value,
    mode: rule.mode,
    resetPolicy: rule.resetPolicy,
    resetIntervalValue: rule.resetIntervalValue,
    resetIntervalUnit: rule.resetIntervalUnit,
    isEnabled: rule.isEnabled,
    isUnlimited: rule.isUnlimited,
    updatedAt: rule.updatedAt,
  };
}

function serializeSimpleRules(state: Awaited<ReturnType<typeof loadAdminPlanLimitState>>, plan: EffectivePlanCode) {
  return APPROVED_LIMIT_KEYS.map((key) => {
    const rule = state.effectiveRulesByPlan[plan][key];
    return {
      key,
      label: rule.label,
      unit: rule.unitLabel,
      mode: rule.mode,
      limit: rule.isUnlimited ? null : rule.value,
      resetPolicy: rule.resetPolicy,
      resetIntervalValue: rule.resetIntervalValue,
      resetIntervalUnit: rule.resetIntervalUnit,
      editableHere: rule.mode === 'usage' && rule.isEnabled,
      inherited: rule.inherited,
      sourceScope: rule.sourceScope,
    };
  });
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const planRaw = String(req.nextUrl.searchParams.get('plan') || '').trim().toLowerCase();
  if (!DEFAULT_PLAN_ORDER.includes(planRaw as EffectivePlanCode)) {
    return json({ ok: false, code: 'invalid_plan', message: 'Choose Free, Pro, or Premium.', requestId }, 400);
  }

  try {
    const plan = planRaw as EffectivePlanCode;
    const state = await loadAdminPlanLimitState(adminResult.supabase);
    return json({ ok: true, requestId, plan, rules: serializeSimpleRules(state, plan) });
  } catch {
    return json({
      ok: false,
      code: 'simple_plan_rules_load_failed',
      message: 'Unable to load plan rules right now. Try again and use the request ID if you need support.',
      requestId,
    }, 500);
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  try {
    const input = requestSchema.parse(await req.json());
    const state = await loadAdminPlanLimitState(adminResult.supabase);
    const effective = state.effectiveRulesByPlan[input.plan][input.metricKey];

    if (!effective.isEnabled || effective.mode !== 'usage') {
      return json({
        ok: false,
        code: 'simple_rule_not_editable',
        message: `${effective.label} is a ${effective.mode} limit. Use advanced Plan Limits for this setting.`,
        requestId,
      }, 400);
    }

    if (!effective.supportedResetPolicies.includes(input.resetPolicy)) {
      return json({
        ok: false,
        code: 'unsupported_reset_policy',
        message: `${effective.label} does not support that reset schedule.`,
        requestId,
      }, 400);
    }

    const existingCustomInterval = input.resetPolicy === 'custom'
      ? {
          value: effective.resetIntervalValue,
          unit: effective.resetIntervalUnit,
        }
      : { value: null, unit: null };

    if (input.resetPolicy === 'custom' && (!existingCustomInterval.value || !existingCustomInterval.unit)) {
      return json({
        ok: false,
        code: 'custom_reset_requires_advanced_editor',
        message: 'Set the custom interval in Advanced Plan Limits first.',
        requestId,
      }, 400);
    }

    const rules = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
      const stored = state.storedRulesByScope[input.plan][key];
      acc[key] = stored ? toStoredRule(stored) : null;
      return acc;
    }, {} as Record<ApprovedLimitKey, StoredPlanLimitRule | null>);

    rules[input.metricKey] = {
      key: input.metricKey,
      value: input.limit,
      mode: effective.mode,
      resetPolicy: input.resetPolicy,
      resetIntervalValue: existingCustomInterval.value,
      resetIntervalUnit: existingCustomInterval.unit,
      isEnabled: true,
      isUnlimited: false,
      updatedAt: new Date().toISOString(),
    };

    await savePlanLimitScopeRules({
      supabase: adminResult.supabase,
      scope: input.plan,
      rules,
    });

    const refreshed = await loadAdminPlanLimitState(adminResult.supabase);
    return json({
      ok: true,
      requestId,
      plan: input.plan,
      metricKey: input.metricKey,
      rules: serializeSimpleRules(refreshed, input.plan),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return json({ ok: false, code: 'invalid_request', message: 'Check the cap and reset schedule.', details: error.flatten(), requestId }, 400);
    }
    return json({
      ok: false,
      code: 'simple_plan_rule_save_failed',
      message: 'Unable to save the plan rule right now. Try again and use the request ID if you need support.',
      requestId,
    }, 500);
  }
}
