export type PlanLimitsByPlan = Record<string, Record<string, number | null>>;
export type PlanLimitDraftByPlan = Record<string, Record<string, string>>;

const KNOWN_PLAN_ORDER = ['free', 'pro', 'premium', 'weekly', 'monthly'] as const;
const MAX_LIMIT_VALUE = 1_000_000_000;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizePlanKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeLimitValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const clamped = Math.max(0, Math.floor(numeric));
  return clamped > MAX_LIMIT_VALUE ? MAX_LIMIT_VALUE : clamped;
}

function collectPlanEntries(payload: unknown): Array<[string, unknown]> {
  const root = asRecord(payload);
  const data = asRecord(root.data);

  const limitsByPlan =
    asRecord(data.limitsByPlan && typeof data.limitsByPlan === 'object' ? data.limitsByPlan : null);
  if (Object.keys(limitsByPlan).length > 0) {
    return Object.entries(limitsByPlan);
  }

  const rootLimitsByPlan =
    asRecord(root.limitsByPlan && typeof root.limitsByPlan === 'object' ? root.limitsByPlan : null);
  if (Object.keys(rootLimitsByPlan).length > 0) {
    return Object.entries(rootLimitsByPlan);
  }

  const planLimitsArray = Array.isArray(data.planLimits)
    ? data.planLimits
    : (Array.isArray(root.planLimits) ? root.planLimits : []);
  if (planLimitsArray.length > 0) {
    return planLimitsArray
      .map((entry) => {
        const row = asRecord(entry);
        const plan = normalizePlanKey(row.plan || row.plan_key || row.tier);
        return [plan, row] as [string, unknown];
      })
      .filter(([plan]) => Boolean(plan));
  }

  return [];
}

function normalizePlanLimitsEntry(rawEntry: unknown, knownFieldKeys: readonly string[]): Record<string, number | null> {
  const planObj = asRecord(rawEntry);
  const nestedLimits = asRecord(planObj.limits);
  const source = Object.keys(nestedLimits).length > 0 ? nestedLimits : planObj;

  const normalized: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(source)) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) continue;
    normalized[cleanKey] = normalizeLimitValue(value);
  }

  for (const key of knownFieldKeys) {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
      normalized[key] = null;
    }
  }

  return normalized;
}

export function orderPlanKeys(planKeys: string[]): string[] {
  const unique = Array.from(new Set(planKeys.map((plan) => normalizePlanKey(plan)).filter(Boolean)));
  unique.sort((a, b) => {
    const aIndex = KNOWN_PLAN_ORDER.indexOf(a as (typeof KNOWN_PLAN_ORDER)[number]);
    const bIndex = KNOWN_PLAN_ORDER.indexOf(b as (typeof KNOWN_PLAN_ORDER)[number]);
    const aKnown = aIndex >= 0;
    const bKnown = bIndex >= 0;
    if (aKnown && bKnown) return aIndex - bIndex;
    if (aKnown) return -1;
    if (bKnown) return 1;
    return a.localeCompare(b);
  });
  return unique;
}

export function formatPlanLabel(planKey: string): string {
  const safe = normalizePlanKey(planKey);
  if (!safe) return 'Unknown';
  return safe
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function parsePlanLimitsPayload(
  payload: unknown,
  knownFieldKeys: readonly string[],
): { limitsByPlan: PlanLimitsByPlan; planKeys: string[] } {
  const limitsByPlan: PlanLimitsByPlan = {};
  const entries = collectPlanEntries(payload);

  for (const [rawPlan, entry] of entries) {
    const plan = normalizePlanKey(rawPlan);
    if (!plan) continue;
    limitsByPlan[plan] = normalizePlanLimitsEntry(entry, knownFieldKeys);
  }

  const planKeys = orderPlanKeys(Object.keys(limitsByPlan));
  return { limitsByPlan, planKeys };
}

export function toPlanLimitDraftByPlan(
  limitsByPlan: PlanLimitsByPlan,
  knownFieldKeys: readonly string[],
): PlanLimitDraftByPlan {
  const out: PlanLimitDraftByPlan = {};
  for (const [plan, limits] of Object.entries(limitsByPlan)) {
    const row: Record<string, string> = {};
    for (const key of knownFieldKeys) {
      const value = limits[key];
      row[key] = value === null || value === undefined ? '' : String(Math.max(0, Math.floor(value)));
    }
    out[plan] = row;
  }
  return out;
}

export function sanitizeLimitInput(raw: string): string {
  return String(raw ?? '').replace(/[^\d]/g, '');
}

export function validatePlanLimitDraft(
  draftByPlan: PlanLimitDraftByPlan,
  selectedPlan: string,
  knownFieldKeys: readonly string[],
): { ok: boolean; errors: string[]; sanitizedDraft: Record<string, string>; limits: Record<string, number> } {
  const rawDraft = asRecord(draftByPlan[selectedPlan]);
  const sanitizedDraft: Record<string, string> = {};
  const limits: Record<string, number> = {};
  const errors: string[] = [];

  for (const key of knownFieldKeys) {
    const rawValue = String(rawDraft[key] ?? '').trim();
    if (!rawValue) {
      sanitizedDraft[key] = '';
      limits[key] = 0;
      continue;
    }

    if (!/^\d+$/.test(rawValue)) {
      errors.push(`${key} must be a non-negative integer.`);
      sanitizedDraft[key] = sanitizeLimitInput(rawValue);
      continue;
    }

    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < 0) {
      errors.push(`${key} must be a non-negative integer.`);
      sanitizedDraft[key] = '';
      continue;
    }

    const clamped = Math.min(MAX_LIMIT_VALUE, Math.floor(numeric));
    sanitizedDraft[key] = String(clamped);
    limits[key] = clamped;
  }

  return {
    ok: errors.length === 0,
    errors,
    sanitizedDraft,
    limits,
  };
}
