import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  APPROVED_LIMIT_KEYS,
  DEFAULT_PLAN_ORDER,
  type EffectivePlanCode,
} from '@/lib/limits/plan-limit-model';
import { loadAdminPlanLimitState } from '@/lib/server/au-limits';

export const runtime = 'nodejs';

const simpleResetPolicies = ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'] as const;

const requestSchema = z.object({
  plan: z.enum(DEFAULT_PLAN_ORDER),
  metricKey: z.enum(APPROVED_LIMIT_KEYS),
  // This is a plan-wide entitlement boundary. Do not coerce strings/null/empty
  // values into numbers: Number('') and Number(null) both become 0, which could
  // accidentally disable a feature for every subscriber on the plan.
  limit: z.number().int().min(0).max(1_000_000_000),
  resetPolicy: z.enum(simpleResetPolicies),
  isUnlimited: z.boolean().optional(),
  revision: z.string().min(1).max(2_000).optional(),
});

type AdminClient = Extract<Awaited<ReturnType<typeof requireConexAdmin>>, { ok: true }>['supabase'];
type AdminLimitState = Awaited<ReturnType<typeof loadAdminPlanLimitState>>;
type EffectiveRule = AdminLimitState['effectiveRulesByPlan'][EffectivePlanCode][(typeof APPROVED_LIMIT_KEYS)[number]];

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function planRuleRevision(rule: EffectiveRule, storedUpdatedAt: string | null) {
  return JSON.stringify({
    v: 1,
    storedUpdatedAt,
    inherited: rule.inherited,
    sourceScope: rule.sourceScope,
    mode: rule.mode,
    isEnabled: rule.isEnabled,
    isUnlimited: rule.isUnlimited,
    value: rule.value,
    resetPolicy: rule.resetPolicy,
    resetIntervalValue: rule.resetIntervalValue,
    resetIntervalUnit: rule.resetIntervalUnit,
  });
}

async function loadStoredRuleRevisions(supabase: AdminClient, plan: EffectivePlanCode) {
  const result = await supabase
    .from('au_plan_limit_rules')
    .select('limit_key,updated_at')
    .eq('scope', plan)
    .in('limit_key', [...APPROVED_LIMIT_KEYS]);

  if (result.error) throw result.error;

  return new Map(
    (result.data || []).map((row) => [String(row.limit_key), String(row.updated_at)] as const),
  );
}

function serializeSimpleRules(
  state: AdminLimitState,
  plan: EffectivePlanCode,
  storedRevisions: Map<string, string>,
) {
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
      revision: planRuleRevision(rule, storedRevisions.get(key) || null),
    };
  });
}

function staleRuleResponse(requestId: string) {
  return json({
    ok: false,
    code: 'plan_rule_changed',
    message: 'This plan rule changed after you opened it. Reload the latest rule and apply your change again.',
    requestId,
  }, 409);
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
    const [state, storedRevisions] = await Promise.all([
      loadAdminPlanLimitState(adminResult.supabase),
      loadStoredRuleRevisions(adminResult.supabase, plan),
    ]);
    return json({ ok: true, requestId, plan, rules: serializeSimpleRules(state, plan, storedRevisions) });
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
    if (!input.revision) return staleRuleResponse(requestId);

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

    const currentRowResult = await adminResult.supabase
      .from('au_plan_limit_rules')
      .select('updated_at')
      .eq('scope', input.plan)
      .eq('limit_key', input.metricKey)
      .maybeSingle();

    if (currentRowResult.error) throw currentRowResult.error;

    const storedUpdatedAt = currentRowResult.data?.updated_at
      ? String(currentRowResult.data.updated_at)
      : null;
    const currentRevision = planRuleRevision(effective, storedUpdatedAt);
    if (input.revision !== currentRevision) return staleRuleResponse(requestId);

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

    // The first simple-editor client encoded an existing unlimited rule as numeric
    // zero and did not send an unlimited flag. Reject that one ambiguous payload
    // rather than silently collapsing a plan-wide unlimited entitlement to zero
    // or pretending a zero cap was saved while preserving unlimited state.
    if (input.isUnlimited === undefined && effective.isUnlimited && input.limit === 0) {
      return json({
        ok: false,
        code: 'explicit_unlimited_state_required',
        message: 'This plan rule is currently Unlimited. Choose an explicit finite cap or use Advanced Plan Limits before saving zero.',
        requestId,
      }, 409);
    }

    const isUnlimited = input.isUnlimited ?? false;
    const simpleFields = {
      value: isUnlimited ? null : input.limit,
      reset_policy: input.resetPolicy,
      reset_interval_value: existingCustomInterval.value,
      reset_interval_unit: existingCustomInterval.unit,
      is_unlimited: isUnlimited,
    };

    if (storedUpdatedAt) {
      // Compare-and-swap against the exact row that was loaded into the simple
      // editor. Only mutate fields owned by this editor so Advanced settings such
      // as mode/is_enabled cannot be restored from a stale effective snapshot.
      const saveResult = await adminResult.supabase
        .from('au_plan_limit_rules')
        .update(simpleFields)
        .eq('scope', input.plan)
        .eq('limit_key', input.metricKey)
        .eq('updated_at', storedUpdatedAt)
        .select('updated_at')
        .maybeSingle();

      if (saveResult.error) throw saveResult.error;
      if (!saveResult.data) return staleRuleResponse(requestId);
    } else {
      // Inherited rules have no plan-scoped row. Insert rather than upsert so a
      // concurrent Advanced editor creating the same override wins with a 409
      // instead of being silently overwritten.
      const saveResult = await adminResult.supabase
        .from('au_plan_limit_rules')
        .insert({
          scope: input.plan,
          limit_key: input.metricKey,
          ...simpleFields,
          mode: effective.mode,
          is_enabled: effective.isEnabled,
        });

      if (saveResult.error) {
        if (saveResult.error.code === '23505') return staleRuleResponse(requestId);
        throw saveResult.error;
      }
    }

    const [refreshed, refreshedRevisions] = await Promise.all([
      loadAdminPlanLimitState(adminResult.supabase),
      loadStoredRuleRevisions(adminResult.supabase, input.plan),
    ]);
    return json({
      ok: true,
      requestId,
      plan: input.plan,
      metricKey: input.metricKey,
      rules: serializeSimpleRules(refreshed, input.plan, refreshedRevisions),
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
