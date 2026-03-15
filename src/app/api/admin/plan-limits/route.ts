import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  APPROVED_LIMIT_KEYS,
  DEFAULT_PLAN_LIMITS,
  DEFAULT_PLAN_ORDER,
  PLAN_LIMIT_DEFINITIONS,
  PLAN_LIMIT_MODE_VALUES,
  PLAN_LIMIT_RESET_INTERVAL_UNIT_VALUES,
  PLAN_LIMIT_RESET_POLICY_VALUES,
  PLAN_LIMIT_STATE_VALUES,
  PLAN_LIMIT_SCOPE_KEYS,
  buildDefaultRuleSet,
  ruleSetToNumericLimits,
  type ApprovedLimitKey,
  type EffectivePlanCode,
  type PlanLimitScopeKey,
} from '@/lib/limits/plan-limit-model';
import {
  describeLimitScope,
  loadAdminPlanLimitState,
  savePlanLimitScopeRules,
  serializeEffectivePlanLimitRule,
  serializeStoredPlanLimitRule,
  toStoredPlanRuleSetForScope,
} from '@/lib/server/au-limits';

export const runtime = 'nodejs';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isPlan(value: string): value is EffectivePlanCode {
  return DEFAULT_PLAN_ORDER.includes(value as EffectivePlanCode);
}

function isScope(value: string): value is PlanLimitScopeKey {
  return PLAN_LIMIT_SCOPE_KEYS.includes(value as PlanLimitScopeKey);
}

function serializeLimitDefinitions() {
  return APPROVED_LIMIT_KEYS.map((key) => {
    const definition = PLAN_LIMIT_DEFINITIONS[key];
    return {
      key,
      label: definition.label,
      description: definition.description,
      unit_label: definition.unitLabel,
      category: definition.category,
      default_mode: definition.defaultMode,
      supported_modes: [...definition.supportedModes],
      default_reset_policy: definition.defaultResetPolicy,
      supported_reset_policies: [...definition.supportedResetPolicies],
      enforced_by: [...definition.enforcedBy],
    };
  });
}

function buildResponsePayload(state: Awaited<ReturnType<typeof loadAdminPlanLimitState>>) {
  const defaultRules = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    acc[key] = serializeStoredPlanLimitRule(state.defaultRules[key]);
    return acc;
  }, {} as Record<ApprovedLimitKey, ReturnType<typeof serializeStoredPlanLimitRule>>);

  const storedRulesByScope = PLAN_LIMIT_SCOPE_KEYS.reduce((acc, scope) => {
    acc[scope] = APPROVED_LIMIT_KEYS.reduce((scopeAcc, key) => {
      scopeAcc[key] = serializeStoredPlanLimitRule(state.storedRulesByScope[scope][key] || null);
      return scopeAcc;
    }, {} as Record<ApprovedLimitKey, ReturnType<typeof serializeStoredPlanLimitRule>>);
    return acc;
  }, {} as Record<PlanLimitScopeKey, Record<ApprovedLimitKey, ReturnType<typeof serializeStoredPlanLimitRule>>>);

  const effectiveRulesByPlan = DEFAULT_PLAN_ORDER.reduce((acc, plan) => {
    acc[plan] = APPROVED_LIMIT_KEYS.reduce((planAcc, key) => {
      planAcc[key] = serializeEffectivePlanLimitRule(state.effectiveRulesByPlan[plan][key]);
      return planAcc;
    }, {} as Record<ApprovedLimitKey, ReturnType<typeof serializeEffectivePlanLimitRule>>);
    return acc;
  }, {} as Record<EffectivePlanCode, Record<ApprovedLimitKey, ReturnType<typeof serializeEffectivePlanLimitRule>>>);

  const limitsByPlan = DEFAULT_PLAN_ORDER.reduce((acc, plan) => {
    acc[plan] = ruleSetToNumericLimits(state.effectiveRulesByPlan[plan]);
    return acc;
  }, {} as Record<EffectivePlanCode, Record<ApprovedLimitKey, number>>);

  return {
    source: state.source,
    planKeys: [...DEFAULT_PLAN_ORDER],
    scopeKeys: [...PLAN_LIMIT_SCOPE_KEYS],
    scopeLabels: PLAN_LIMIT_SCOPE_KEYS.reduce((acc, scope) => {
      acc[scope] = describeLimitScope(scope);
      return acc;
    }, {} as Record<PlanLimitScopeKey, string>),
    limitDefinitions: serializeLimitDefinitions(),
    defaultRules,
    storedRulesByScope,
    effectiveRulesByPlan,
    limitsByPlan,
    defaultLimitsByPlan: DEFAULT_PLAN_LIMITS,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeRuleInputs(raw: unknown) {
  const source = asRecord(raw);
  return APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    const input = asRecord(source[key]);
    acc[key] = {
      inheritsDefault: Boolean(input.inheritsDefault ?? input.inherits_default),
      value: input.value,
      mode: input.mode,
      state: input.state,
      resetPolicy: input.resetPolicy ?? input.reset_policy,
      resetIntervalValue: input.resetIntervalValue ?? input.reset_interval_value,
      resetIntervalUnit: input.resetIntervalUnit ?? input.reset_interval_unit,
      isEnabled: input.isEnabled ?? input.is_enabled,
      isUnlimited: input.isUnlimited ?? input.is_unlimited,
      updatedAt: input.updatedAt ?? input.updated_at,
    };
    return acc;
  }, {} as Record<ApprovedLimitKey, Record<string, unknown>>);
}

function collectRuleValidationErrors(
  scope: PlanLimitScopeKey,
  ruleInputs: Record<ApprovedLimitKey, Record<string, unknown>>,
) {
  const errors = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    const input = ruleInputs[key] || {};
    const issues: string[] = [];
    const definition = PLAN_LIMIT_DEFINITIONS[key];
    const inheritsDefault = Boolean(input.inheritsDefault ?? input.inherits_default);

    if (scope !== 'default' && inheritsDefault) {
      acc[key] = issues;
      return acc;
    }

    const rawState = String(input.state ?? '').trim().toLowerCase();
    const state = rawState
      ? (PLAN_LIMIT_STATE_VALUES.includes(rawState as (typeof PLAN_LIMIT_STATE_VALUES)[number]) ? rawState : null)
      : 'capped';
    if (rawState && !state) {
      issues.push(`State must be one of: ${PLAN_LIMIT_STATE_VALUES.join(', ')}.`);
    }

    const rawMode = String(input.mode ?? '').trim().toLowerCase();
    const mode = rawMode
      ? (PLAN_LIMIT_MODE_VALUES.includes(rawMode as (typeof PLAN_LIMIT_MODE_VALUES)[number]) ? rawMode : null)
      : definition.defaultMode;
    if (rawMode && !mode) {
      issues.push(`Mode must be one of: ${PLAN_LIMIT_MODE_VALUES.join(', ')}.`);
    } else if (mode && !definition.supportedModes.includes(mode as typeof definition.defaultMode)) {
      issues.push(`${definition.label} only supports: ${definition.supportedModes.join(', ')}.`);
    }

    const rawResetPolicy = String(input.resetPolicy ?? input.reset_policy ?? '').trim().toLowerCase();
    const resetPolicy = rawResetPolicy
      ? (
          PLAN_LIMIT_RESET_POLICY_VALUES.includes(
            rawResetPolicy as (typeof PLAN_LIMIT_RESET_POLICY_VALUES)[number],
          )
            ? rawResetPolicy
            : null
        )
      : definition.defaultResetPolicy;
    if (rawResetPolicy && !resetPolicy) {
      issues.push(`Reset policy must be one of: ${PLAN_LIMIT_RESET_POLICY_VALUES.join(', ')}.`);
    } else if (resetPolicy && !definition.supportedResetPolicies.includes(resetPolicy as typeof definition.defaultResetPolicy)) {
      issues.push(`${definition.label} only supports reset policies: ${definition.supportedResetPolicies.join(', ')}.`);
    }

    if (state !== 'disabled' && state !== 'unlimited') {
      const rawValue = input.value;
      const hasValue = rawValue !== null && rawValue !== undefined && rawValue !== '';
      const numericValue = Number(rawValue);
      if (!hasValue) {
        issues.push('Value is required unless the limit is disabled or unlimited.');
      } else if (!Number.isFinite(numericValue) || numericValue < 0 || !Number.isInteger(numericValue)) {
        issues.push('Value must be a whole number greater than or equal to 0.');
      }
    }

    if (mode && mode !== 'usage' && resetPolicy && resetPolicy !== 'never') {
      issues.push('Only usage-based limits can use hourly, daily, weekly, monthly, or custom reset schedules.');
    }

    if (resetPolicy === 'custom') {
      const rawIntervalValue = input.resetIntervalValue ?? input.reset_interval_value;
      const intervalValue = Number(rawIntervalValue);
      if (!Number.isFinite(intervalValue) || intervalValue <= 0 || !Number.isInteger(intervalValue)) {
        issues.push('Custom reset interval value must be a whole number greater than 0.');
      }

      const rawIntervalUnit = String(input.resetIntervalUnit ?? input.reset_interval_unit ?? '').trim().toLowerCase();
      if (!PLAN_LIMIT_RESET_INTERVAL_UNIT_VALUES.includes(rawIntervalUnit as (typeof PLAN_LIMIT_RESET_INTERVAL_UNIT_VALUES)[number])) {
        issues.push(`Custom reset interval unit must be one of: ${PLAN_LIMIT_RESET_INTERVAL_UNIT_VALUES.join(', ')}.`);
      }
    }

    acc[key] = issues;
    return acc;
  }, {} as Record<ApprovedLimitKey, string[]>);

  return errors;
}

function nullRuleMap() {
  return APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {} as Record<ApprovedLimitKey, null>);
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  try {
    const state = await loadAdminPlanLimitState(adminResult.supabase);
    return NextResponse.json(
      {
        ok: true,
        requestId,
        ...buildResponsePayload(state),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: 'plan_limits_fetch_failed',
        message: String(error?.message || error),
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const body = await req.json().catch(() => ({}));
  const scope = String((body as any)?.scope ?? ((body as any)?.plan || '')).trim().toLowerCase();
  const action = String((body as any)?.action || 'save').trim().toLowerCase();

  if (!isScope(scope)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_scope',
        message: 'scope must be one of: default, free, pro, premium.',
        requestId,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = adminResult.supabase;

    if (action === 'reset_scope') {
      await savePlanLimitScopeRules({
        supabase,
        scope,
        rules: scope === 'default' ? buildDefaultRuleSet() : nullRuleMap(),
      });
    } else if (action === 'save') {
      const state = await loadAdminPlanLimitState(supabase);
      const rawRuleInputs = (body as any)?.rule_inputs ?? (body as any)?.ruleInputs ?? (body as any)?.rules;
      const normalizedInputs = normalizeRuleInputs(rawRuleInputs);
      const validationErrors = collectRuleValidationErrors(scope, normalizedInputs);
      const hasErrors = Object.values(validationErrors).some((issues) => issues.length > 0);
      if (hasErrors) {
        return NextResponse.json(
          {
            ok: false,
            code: 'invalid_plan_limit_rule',
            message: 'One or more limit rules are invalid.',
            requestId,
            validationErrors,
          },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      const rules = toStoredPlanRuleSetForScope({
        scope,
        defaultRules: state.defaultRules,
        ruleInputs: normalizedInputs as any,
      });
      await savePlanLimitScopeRules({ supabase, scope, rules });
    } else {
      return NextResponse.json(
        {
          ok: false,
          code: 'invalid_action',
          message: 'action must be "save" or "reset_scope".',
          requestId,
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const nextState = await loadAdminPlanLimitState(supabase);
    return NextResponse.json(
      {
        ok: true,
        requestId,
        scope,
        plan: isPlan(scope) ? scope : null,
        action,
        ...buildResponsePayload(nextState),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: 'plan_limits_save_failed',
        message: String(error?.message || error),
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
