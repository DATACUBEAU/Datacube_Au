import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveEntitlementsSnapshot } from '@/lib/server/effective-entitlements';
import {
  APPROVED_LIMIT_KEYS,
  DEFAULT_PLAN_LIMITS,
  DEFAULT_PLAN_ORDER,
  PLAN_LIMIT_SCOPE_KEYS,
  PLAN_LIMIT_DEFINITIONS,
  arePlanLimitRulesEqual,
  buildPlanLimitPresentation,
  buildDefaultPlanLimitRule,
  buildDefaultRuleSet,
  buildSeedPlanRuleSet,
  buildSeedScopeRules,
  computeResetWindow,
  describeResetPolicy,
  type PlanLimitPresentation,
  formatScopeLabel,
  getLimitCap,
  mergePlanLimitRuleSets,
  normalizePlanLimitMode,
  normalizeStoredPlanLimitRule,
  ruleSetToNumericLimits,
  type ApprovedLimitKey,
  type EffectivePlanCode,
  type EffectivePlanLimitRule,
  type PlanLimitResetIntervalUnit,
  type PlanLimitResetPolicy,
  type PlanLimitScopeKey,
  type StoredPlanLimitRule,
} from '@/lib/limits/plan-limit-model';
import {
  FREE_PLAN_EXPIRATION_DAYS,
  PAID_PRO_PLAN_EXPIRATION_DAYS,
  PREMIUM_PLAN_EXPIRATION_DAYS,
  normalizeEntitlementSource,
} from '@/lib/plans/subscription-policy';
import { LARGE_FILE_DISABLED_MESSAGE } from '@/lib/upload/large-file-gating';
import { safeSelectDocuments, type DocumentUsageRow } from '@/lib/server/document-usage-query';
import { loadUsageCounterSnapshots, resolveUsageMetricForRule } from '@/lib/server/usage-tracking';

const ONE_MB_BYTES = 1024 * 1024;

export { DEFAULT_PLAN_LIMITS, DEFAULT_PLAN_ORDER };
export type { ApprovedLimitKey, EffectivePlanCode, EffectivePlanLimitRule, PlanLimitScopeKey, StoredPlanLimitRule };

export type CanonicalPlanLimits = Record<ApprovedLimitKey, number>;

export type PlanMetadata = {
  label: string;
  description: string;
  price_display: string;
  monthly_amount_ngn: number | null;
  monthly_compare_at_ngn: number | null;
  monthly_badge: string;
  weekly_amount_ngn: number | null;
  weekly_compare_at_ngn: number | null;
  weekly_badge: string;
  feature_bullets: string[];
  cta_label: string;
  cta_href: string;
  sort_order: number;
  retention_days: number;
  expiration_days: number;
};

export type PublicPlanPricing = {
  monthly: {
    amount: number;
    compare_at: number | null;
    label: string;
    plan_key: string | null;
  } | null;
  weekly: {
    amount: number;
    compare_at: number | null;
    label: string;
    plan_key: string | null;
  } | null;
};

type BillingPricingRows = Partial<Record<'monthly' | 'weekly', { amount: number; plan_key: string }>>;

export type PublicPlanCatalogEntry = {
  plan: EffectivePlanCode;
  isDefault: boolean;
  metadata: PlanMetadata;
  pricing: PublicPlanPricing;
  limits: CanonicalPlanLimits;
  limitRules: Record<ApprovedLimitKey, EffectivePlanLimitRule>;
  resetLabels: Record<ApprovedLimitKey, string>;
};

export const DEFAULT_PLAN_METADATA: Record<EffectivePlanCode, PlanMetadata> = {
  free: {
    label: 'Free',
    description: 'Core study tools with daily AI quotas and capped stored uploads.',
    price_display: 'NGN 0',
    monthly_amount_ngn: 0,
    monthly_compare_at_ngn: null,
    monthly_badge: '',
    weekly_amount_ngn: 0,
    weekly_compare_at_ngn: null,
    weekly_badge: '',
    feature_bullets: ['Document chat', 'Stored upload cap', 'Knowledge Hub access', 'Basic support'],
    cta_label: 'Current plan',
    cta_href: '/dashboard',
    sort_order: 0,
    retention_days: FREE_PLAN_EXPIRATION_DAYS,
    expiration_days: FREE_PLAN_EXPIRATION_DAYS,
  },
  pro: {
    label: 'Pro',
    description: 'Higher quotas for chat, tokens, uploads, and advanced study generation workflows.',
    price_display: 'NGN 4,500/month or NGN 1,500/week',
    monthly_amount_ngn: 4500,
    monthly_compare_at_ngn: 6000,
    monthly_badge: 'Save 25%',
    weekly_amount_ngn: 1500,
    weekly_compare_at_ngn: 2500,
    weekly_badge: 'Save 40%',
    feature_bullets: ['Knowledge Hub', 'Exam Prediction Engine', 'Practice exams', 'Higher runtime caps'],
    cta_label: 'Upgrade now',
    cta_href: '/dashboard/settings/subscription',
    sort_order: 1,
    retention_days: PAID_PRO_PLAN_EXPIRATION_DAYS,
    expiration_days: PAID_PRO_PLAN_EXPIRATION_DAYS,
  },
  premium: {
    label: 'Premium',
    description: 'Custom higher-volume workspace with expanded quotas and concurrency.',
    price_display: 'Custom pricing',
    monthly_amount_ngn: null,
    monthly_compare_at_ngn: null,
    monthly_badge: '',
    weekly_amount_ngn: null,
    weekly_compare_at_ngn: null,
    weekly_badge: '',
    feature_bullets: ['Everything in Pro', 'Higher concurrency', 'More stored outputs', 'Custom support'],
    cta_label: 'Contact admin',
    cta_href: 'https://wa.me/2349036553377',
    sort_order: 2,
    retention_days: PREMIUM_PLAN_EXPIRATION_DAYS,
    expiration_days: PREMIUM_PLAN_EXPIRATION_DAYS,
  },
};

export type EffectivePlan = {
  plan: EffectivePlanCode;
  isAdmin: boolean;
  hasPro: boolean;
  source: 'au_user_entitlements' | 'profile' | 'billing' | 'default';
  entitlementSource: 'paid' | 'promo' | 'none';
  expiresAt: string | null;
};

type EffectivePlanResolutionInput = {
  profileTier?: unknown;
  mirroredPlan?: unknown;
  mirroredSource?: unknown;
  mirroredExpiresAt?: string | null;
  entitlementPlan?: unknown;
  entitlementSource?: unknown;
  entitlementEndsAt?: string | null;
};

export type LimitUsageSnapshot = {
  key: ApprovedLimitKey;
  used: number;
  limit: number | null;
  remaining: number | null;
  state: 'capped' | 'unlimited' | 'disabled';
  mode: EffectivePlanLimitRule['mode'];
  label: string;
  description: string;
  category: EffectivePlanLimitRule['category'];
  reset: {
    policy: PlanLimitResetPolicy;
    intervalValue: number | null;
    intervalUnit: PlanLimitResetIntervalUnit | null;
    window_start: string;
    window_end: string | null;
    label: string;
  };
};

export type EffectiveUsage = {
  today: Record<ApprovedLimitKey, number>;
  total: Record<ApprovedLimitKey, number>;
  by_limit: Record<ApprovedLimitKey, LimitUsageSnapshot>;
  windows: Record<ApprovedLimitKey, LimitUsageSnapshot['reset']>;
  reset_policies: Record<ApprovedLimitKey, PlanLimitResetPolicy>;
  reset_at: string | null;
};

export type EffectiveLimitsResult = {
  plan: EffectivePlanCode;
  effectivePlan: EffectivePlan;
  limits: CanonicalPlanLimits;
  limitRules: Record<ApprovedLimitKey, EffectivePlanLimitRule>;
  usage: EffectiveUsage;
};

export type SerializedPlanLimitPresentation = {
  cap_label: string;
  mode_label: string;
  reset_label: string;
  reset_description: string;
  summary: string;
};

export type EffectivePlanLimitSnapshot = {
  plan: EffectivePlanCode;
  limits: CanonicalPlanLimits;
  limitRules: Record<ApprovedLimitKey, EffectivePlanLimitRule>;
  usage: EffectiveUsage;
};

export type LimitPayload = {
  status: number;
  code: string;
  message: string;
  limit: ApprovedLimitKey;
  current: number;
  action: string;
  correlation_id: string;
  max?: number | null;
  used?: number;
  reset_at?: string | null;
};

type RawPlanLimitRow = {
  scope: string;
  limit_key: string;
  value: number | null;
  mode: string;
  reset_policy: string;
  reset_interval_value: number | null;
  reset_interval_unit: string | null;
  is_enabled: boolean;
  is_unlimited: boolean;
  updated_at: string | null;
};

type PlanLimitCatalog = {
  source: 'au_plan_limit_rules' | 'legacy_plan_limits' | 'seed_defaults';
  defaultRules: Record<ApprovedLimitKey, StoredPlanLimitRule>;
  overridesByPlan: Record<EffectivePlanCode, Partial<Record<ApprovedLimitKey, StoredPlanLimitRule | null>>>;
  effectiveRulesByPlan: Record<EffectivePlanCode, Record<ApprovedLimitKey, EffectivePlanLimitRule>>;
  storedRulesByScope: Record<PlanLimitScopeKey, Partial<Record<ApprovedLimitKey, StoredPlanLimitRule>>>;
};

export class EffectiveLimitError extends Error {
  status: number;
  payload: LimitPayload;
  headers: Record<string, string>;

  constructor(status: number, payload: LimitPayload, headers?: Record<string, string>) {
    super(payload.message);
    this.status = status;
    this.payload = payload;
    this.headers = headers || {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code.startsWith('PGRST') ||
    message.includes('does not exist') ||
    details.includes('does not exist') ||
    message.includes('schema cache') ||
    details.includes('schema cache') ||
    message.includes('could not find')
  );
}

function clampNonNegativeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

function clampNullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function asTrimmedString(value: unknown, fallback: string): string {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function normalizePlan(value: unknown): EffectivePlanCode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'premium') return 'premium';
  if (raw === 'pro' || raw === 'promo_pro' || raw === 'weekly' || raw === 'monthly' || raw === 'paid') return 'pro';
  return 'free';
}

function normalizeProfileTier(value: unknown): { isAdmin: boolean; plan: EffectivePlanCode | null } {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return { isAdmin: false, plan: null };
  if (raw === 'admin') return { isAdmin: true, plan: 'pro' };
  if (raw === 'premium') return { isAdmin: false, plan: 'premium' };
  if (['pro', 'weekly', 'monthly', 'paid'].includes(raw)) return { isAdmin: false, plan: 'pro' };
  if (raw === 'free') return { isAdmin: false, plan: 'free' };
  return { isAdmin: false, plan: null };
}

function normalizePlanMetadata(plan: EffectivePlanCode, input: unknown): PlanMetadata {
  const source = asRecord(input);
  const defaults = DEFAULT_PLAN_METADATA[plan];
  const minPaidRetentionDays = plan === 'pro' || plan === 'premium' ? PAID_PRO_PLAN_EXPIRATION_DAYS : 0;
  const retentionDays = clampNonNegativeNumber(source.retention_days ?? source.retentionDays, defaults.retention_days);
  const expirationDays = clampNonNegativeNumber(source.expiration_days ?? source.expirationDays, defaults.expiration_days);
  return {
    label: asTrimmedString(source.label, defaults.label),
    description: asTrimmedString(source.description, defaults.description),
    price_display: asTrimmedString(source.price_display ?? source.priceDisplay, defaults.price_display),
    monthly_amount_ngn: clampNullableNonNegativeNumber(source.monthly_amount_ngn ?? source.monthlyAmountNgn) ?? defaults.monthly_amount_ngn,
    monthly_compare_at_ngn:
      clampNullableNonNegativeNumber(source.monthly_compare_at_ngn ?? source.monthlyCompareAtNgn) ?? defaults.monthly_compare_at_ngn,
    monthly_badge: asTrimmedString(source.monthly_badge ?? source.monthlyBadge, defaults.monthly_badge),
    weekly_amount_ngn: clampNullableNonNegativeNumber(source.weekly_amount_ngn ?? source.weeklyAmountNgn) ?? defaults.weekly_amount_ngn,
    weekly_compare_at_ngn:
      clampNullableNonNegativeNumber(source.weekly_compare_at_ngn ?? source.weeklyCompareAtNgn) ?? defaults.weekly_compare_at_ngn,
    weekly_badge: asTrimmedString(source.weekly_badge ?? source.weeklyBadge, defaults.weekly_badge),
    feature_bullets: asStringList(source.feature_bullets ?? source.featureBullets, defaults.feature_bullets),
    cta_label: asTrimmedString(source.cta_label ?? source.ctaLabel, defaults.cta_label),
    cta_href: asTrimmedString(source.cta_href ?? source.ctaHref, defaults.cta_href),
    sort_order: clampNonNegativeNumber(source.sort_order ?? source.sortOrder, defaults.sort_order),
    retention_days: Math.max(minPaidRetentionDays, retentionDays),
    expiration_days: Math.max(minPaidRetentionDays, expirationDays),
  };
}

function featureBulletsJson(featureBullets: string[]): string[] {
  return featureBullets.map((value) => String(value || '').trim()).filter(Boolean);
}

function buildRuleRowPayload(scope: PlanLimitScopeKey, rule: StoredPlanLimitRule): RawPlanLimitRow {
  return {
    scope,
    limit_key: rule.key,
    value: rule.value,
    mode: rule.mode,
    reset_policy: rule.resetPolicy,
    reset_interval_value: rule.resetIntervalValue,
    reset_interval_unit: rule.resetIntervalUnit,
    is_enabled: rule.isEnabled,
    is_unlimited: rule.isUnlimited,
    updated_at: new Date().toISOString(),
  };
}

function mapRuleRow(row: RawPlanLimitRow): StoredPlanLimitRule | null {
  const key = String(row.limit_key || '').trim() as ApprovedLimitKey;
  if (!APPROVED_LIMIT_KEYS.includes(key)) return null;
  return normalizeStoredPlanLimitRule(
    key,
    {
      value: row.value,
      mode: row.mode,
      reset_policy: row.reset_policy,
      reset_interval_value: row.reset_interval_value,
      reset_interval_unit: row.reset_interval_unit,
      isEnabled: row.is_enabled,
      isUnlimited: row.is_unlimited,
      updated_at: row.updated_at,
    },
    buildDefaultPlanLimitRule(key),
  );
}

async function ensurePlanSeedRow(
  supabase: SupabaseClient,
  table: 'au_plans' | 'au_plan_metadata',
  plan: EffectivePlanCode,
): Promise<void> {
  if (table === 'au_plans') {
    const { data, error } = await supabase.from('au_plans').select('plan').eq('plan', plan).maybeSingle();
    if (error) {
      if (isSchemaDriftError(error)) return;
      throw error;
    }
    if (!data) {
      const { error: insertError } = await supabase.from('au_plans').insert({ plan, is_default: plan === 'free' });
      if (insertError && String((insertError as any)?.code || '') !== '23505') throw insertError;
    }
    return;
  }

  const { data, error } = await supabase.from('au_plan_metadata').select('plan').eq('plan', plan).maybeSingle();
  if (error) {
    if (isSchemaDriftError(error)) return;
    throw error;
  }
  if (!data) {
    const defaults = DEFAULT_PLAN_METADATA[plan];
    const { error: insertError } = await supabase.from('au_plan_metadata').insert({
      plan,
      ...defaults,
      feature_bullets: featureBulletsJson(defaults.feature_bullets),
    });
    if (insertError && String((insertError as any)?.code || '') !== '23505') throw insertError;
  }
}

async function seedApprovedLimitRules(supabase: SupabaseClient): Promise<boolean> {
  const countRes = await supabase.from('au_plan_limit_rules').select('scope', { count: 'exact', head: true });
  if (countRes.error) {
    if (isSchemaDriftError(countRes.error)) return false;
    throw countRes.error;
  }
  if (Number(countRes.count || 0) > 0) return true;

  const payload: RawPlanLimitRow[] = [];
  const legacyRuleSets = await Promise.all(DEFAULT_PLAN_ORDER.map((plan) => loadLegacyPlanRuleSet(supabase, plan)));
  const foundLegacy = legacyRuleSets.some((entry) => entry.found);
  const defaultRules = foundLegacy ? legacyRuleSets[0].rules : buildDefaultRuleSet();

  for (const rule of Object.values(defaultRules)) {
    payload.push(buildRuleRowPayload('default', rule));
  }
  for (const plan of DEFAULT_PLAN_ORDER) {
    const planRules = foundLegacy
      ? legacyRuleSets.find((entry, index) => DEFAULT_PLAN_ORDER[index] === plan)?.rules || buildSeedPlanRuleSet(plan)
      : buildSeedPlanRuleSet(plan);
    for (const key of APPROVED_LIMIT_KEYS) {
      if (plan === 'free') continue;
      const rule = planRules[key];
      if (!rule || arePlanLimitRulesEqual(rule, defaultRules[key])) continue;
      payload.push(buildRuleRowPayload(plan, rule));
    }
  }

  const { error } = await supabase.from('au_plan_limit_rules').upsert(payload, { onConflict: 'scope,limit_key' });
  if (error) {
    if (isSchemaDriftError(error)) return false;
    throw error;
  }
  return true;
}

type LegacyPlanLimitRuleSetResult = {
  rules: Record<ApprovedLimitKey, StoredPlanLimitRule>;
  found: boolean;
};

function applyLegacyResetPolicy(
  key: ApprovedLimitKey,
  base: StoredPlanLimitRule,
  rawDays: unknown,
): StoredPlanLimitRule {
  const days = clampNonNegativeNumber(rawDays, 0);
  if (days <= 0) {
    const defaultMode =
      key === 'max_uploads_total'
        ? 'current'
        : key === 'max_knowledge_hub'
          ? 'current'
          : normalizePlanLimitMode(base.mode, 'usage');
    return normalizeStoredPlanLimitRule(
      key,
      {
        ...base,
        mode: defaultMode,
        reset_policy: 'never',
      },
      base,
    );
  }
  return normalizeStoredPlanLimitRule(
    key,
    {
      ...base,
      mode: 'usage',
      reset_policy: days === 1 ? 'daily' : 'custom',
      reset_interval_value: days === 1 ? null : days,
      reset_interval_unit: days === 1 ? null : 'day',
    },
    base,
  );
}

function legacyRowToRuleSet(plan: EffectivePlanCode, row: Record<string, unknown>): Record<ApprovedLimitKey, StoredPlanLimitRule> {
  const seeded = buildSeedPlanRuleSet(plan);
  const examCap = clampNonNegativeNumber(
    row.max_exam_predictions ?? row.max_practice_exams ?? row.max_exams_total,
    seeded.max_exam_predictions.value ?? 0,
  );
  const knowledgeCap = clampNonNegativeNumber(
    row.max_knowledge_hub ?? row.max_documents_total ?? row.max_docs_total ?? row.max_uploads_total,
    seeded.max_knowledge_hub.value ?? 0,
  );

  const mapped = {
    max_chats_total: normalizeStoredPlanLimitRule(
      'max_chats_total',
      { ...seeded.max_chats_total, value: row.max_chats_total ?? row.max_messages_per_day },
      seeded.max_chats_total,
    ),
    max_uploads_total: normalizeStoredPlanLimitRule(
      'max_uploads_total',
      { ...seeded.max_uploads_total, value: row.max_uploads_total },
      seeded.max_uploads_total,
    ),
    max_tokens_total: normalizeStoredPlanLimitRule(
      'max_tokens_total',
      { ...seeded.max_tokens_total, value: row.max_tokens_total ?? row.max_tokens_per_day },
      seeded.max_tokens_total,
    ),
    max_file_size_mb: normalizeStoredPlanLimitRule(
      'max_file_size_mb',
      { ...seeded.max_file_size_mb, value: row.max_file_size_mb ?? row.max_file_mb },
      seeded.max_file_size_mb,
    ),
    max_concurrent_jobs: normalizeStoredPlanLimitRule(
      'max_concurrent_jobs',
      { ...seeded.max_concurrent_jobs, value: row.max_concurrent_jobs ?? row.max_jobs_concurrent },
      seeded.max_concurrent_jobs,
    ),
    max_exam_predictions: normalizeStoredPlanLimitRule(
      'max_exam_predictions',
      { ...seeded.max_exam_predictions, value: examCap },
      seeded.max_exam_predictions,
    ),
    max_practice_exams: normalizeStoredPlanLimitRule(
      'max_practice_exams',
      { ...seeded.max_practice_exams, value: examCap },
      seeded.max_practice_exams,
    ),
    max_knowledge_hub: normalizeStoredPlanLimitRule(
      'max_knowledge_hub',
      { ...seeded.max_knowledge_hub, value: knowledgeCap },
      seeded.max_knowledge_hub,
    ),
  } satisfies Record<ApprovedLimitKey, StoredPlanLimitRule>;

  mapped.max_chats_total = applyLegacyResetPolicy('max_chats_total', mapped.max_chats_total, row.chats_reset_every_days);
  mapped.max_tokens_total = applyLegacyResetPolicy('max_tokens_total', mapped.max_tokens_total, row.tokens_reset_every_days);
  mapped.max_uploads_total = applyLegacyResetPolicy('max_uploads_total', mapped.max_uploads_total, row.uploads_reset_every_days);
  mapped.max_exam_predictions = applyLegacyResetPolicy('max_exam_predictions', mapped.max_exam_predictions, row.exams_reset_every_days);
  mapped.max_practice_exams = applyLegacyResetPolicy('max_practice_exams', mapped.max_practice_exams, row.exams_reset_every_days);
  mapped.max_knowledge_hub = applyLegacyResetPolicy('max_knowledge_hub', mapped.max_knowledge_hub, row.documents_reset_every_days);

  return mapped;
}

async function loadLegacyPlanRuleSet(
  supabase: SupabaseClient,
  plan: EffectivePlanCode,
): Promise<LegacyPlanLimitRuleSetResult> {
  // Legacy columns are read only to migrate existing production values into the
  // canonical rule table when older environments have not been backfilled yet.
  const primary = await supabase
    .from('au_plan_limits')
    .select(
      [
        'max_file_size_mb',
        'max_uploads_total',
        'max_documents_total',
        'max_chats_total',
        'max_exams_total',
        'max_tokens_total',
        'max_concurrent_jobs',
        'tokens_reset_every_days',
        'chats_reset_every_days',
        'uploads_reset_every_days',
        'documents_reset_every_days',
        'exams_reset_every_days',
      ].join(','),
    )
    .eq('plan', plan)
    .maybeSingle();

  if (!primary.error && primary.data) {
    return {
      rules: legacyRowToRuleSet(plan, primary.data as unknown as Record<string, unknown>),
      found: true,
    };
  }

  if (primary.error && !isSchemaDriftError(primary.error)) throw primary.error;

  const fallback = await supabase
    .from('plan_limits')
    .select('limits,effective_from')
    .eq('plan', plan)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fallback.error && fallback.data?.limits) {
    return {
      rules: legacyRowToRuleSet(plan, fallback.data.limits as Record<string, unknown>),
      found: true,
    };
  }

  return {
    rules: buildSeedPlanRuleSet(plan),
    found: false,
  };
}

async function loadPlanLimitCatalog(supabase: SupabaseClient): Promise<PlanLimitCatalog> {
  const defaultRules = buildDefaultRuleSet();
  const emptyOverrides = DEFAULT_PLAN_ORDER.reduce((acc, plan) => {
    acc[plan] = {};
    return acc;
  }, {} as Record<EffectivePlanCode, Partial<Record<ApprovedLimitKey, StoredPlanLimitRule | null>>>);
  const emptyStoredScopes = PLAN_LIMIT_SCOPE_KEYS.reduce((acc, scope) => {
    acc[scope] = {};
    return acc;
  }, {} as Record<PlanLimitScopeKey, Partial<Record<ApprovedLimitKey, StoredPlanLimitRule>>>);

  const seeded = await seedApprovedLimitRules(supabase).catch(() => false);
  if (seeded) {
    const { data, error } = await supabase
      .from('au_plan_limit_rules')
      .select('scope,limit_key,value,mode,reset_policy,reset_interval_value,reset_interval_unit,is_enabled,is_unlimited,updated_at');

    if (error) {
      if (!isSchemaDriftError(error)) throw error;
    } else {
      const storedRulesByScope = { ...emptyStoredScopes };
      const defaultMerged = { ...defaultRules };
      for (const raw of (data || []) as RawPlanLimitRow[]) {
        const scope = String(raw.scope || '').trim().toLowerCase() as PlanLimitScopeKey;
        if (!PLAN_LIMIT_SCOPE_KEYS.includes(scope)) continue;
        const mapped = mapRuleRow(raw);
        if (!mapped) continue;
        storedRulesByScope[scope][mapped.key] = mapped;
        if (scope === 'default') {
          defaultMerged[mapped.key] = mapped;
        }
      }

      const overridesByPlan = { ...emptyOverrides };
      for (const plan of DEFAULT_PLAN_ORDER) {
        for (const key of APPROVED_LIMIT_KEYS) {
          const rule = storedRulesByScope[plan][key];
          if (rule) overridesByPlan[plan][key] = rule;
        }
      }

      const effectiveRulesByPlan = DEFAULT_PLAN_ORDER.reduce((acc, plan) => {
        acc[plan] = mergePlanLimitRuleSets({
          scope: plan,
          defaultRules: defaultMerged,
          overrides: overridesByPlan[plan],
        });
        return acc;
      }, {} as Record<EffectivePlanCode, Record<ApprovedLimitKey, EffectivePlanLimitRule>>);

      return {
        source: 'au_plan_limit_rules',
        defaultRules: defaultMerged,
        overridesByPlan,
        effectiveRulesByPlan,
        storedRulesByScope,
      };
    }
  }

  let foundLegacy = false;
  const effectiveRulesByPlan = {} as Record<EffectivePlanCode, Record<ApprovedLimitKey, EffectivePlanLimitRule>>;
  for (const plan of DEFAULT_PLAN_ORDER) {
    const legacy = await loadLegacyPlanRuleSet(supabase, plan);
    foundLegacy = foundLegacy || legacy.found;
    effectiveRulesByPlan[plan] = mergePlanLimitRuleSets({
      scope: plan,
      defaultRules,
      overrides: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const legacyRule = legacy.rules[key];
        if (plan !== 'free') acc[key] = legacyRule;
        return acc;
      }, {} as Partial<Record<ApprovedLimitKey, StoredPlanLimitRule | null>>),
    });
  }

  return {
    source: foundLegacy ? 'legacy_plan_limits' : 'seed_defaults',
    defaultRules,
    overridesByPlan: emptyOverrides,
    effectiveRulesByPlan,
    storedRulesByScope: emptyStoredScopes,
  };
}

export async function resolveEffectivePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectivePlan> {
  const [entitlementRes, profileRes, entitlements] = await Promise.all([
    supabase.from('au_user_entitlements').select('plan,source,expires_at').eq('user_id', userId).maybeSingle(),
    supabase.from('au_user_profiles').select('tier').eq('user_id', userId).maybeSingle(),
    getEffectiveEntitlementsSnapshot(supabase, userId).catch(() => null),
  ]);

  return resolveEffectivePlanFromInputs({
    profileTier: profileRes.data?.tier,
    mirroredPlan: !entitlementRes.error ? (entitlementRes.data as any)?.plan : null,
    mirroredSource: (entitlementRes.data as any)?.source,
    mirroredExpiresAt: typeof (entitlementRes.data as any)?.expires_at === 'string'
      ? String((entitlementRes.data as any).expires_at)
      : null,
    entitlementPlan: entitlements?.plan ?? null,
    entitlementSource: entitlements?.entitlementSource ?? null,
    entitlementEndsAt: entitlements?.entitlementEndsAt ?? null,
  });
}

export function resolveEffectivePlanFromInputs(input: EffectivePlanResolutionInput): EffectivePlan {
  const profileTierRaw = String(input.profileTier || '').trim().toLowerCase();
  const profileInfo = normalizeProfileTier(input.profileTier);
  const mirroredPlanRaw = String(input.mirroredPlan || '').trim().toLowerCase();
  const mirroredPlan = mirroredPlanRaw && mirroredPlanRaw !== 'promo_pro' ? normalizePlan(mirroredPlanRaw) : null;
  const mirroredSource = normalizeEntitlementSource(
    typeof input.mirroredSource === 'string' ? input.mirroredSource : null,
  );
  const mirroredExpiresAt = typeof input.mirroredExpiresAt === 'string' ? input.mirroredExpiresAt : null;
  const entitlementPlanRaw = String(input.entitlementPlan || '').trim().toLowerCase();
  const entitlementPlan = entitlementPlanRaw && entitlementPlanRaw !== 'promo_pro' ? normalizePlan(entitlementPlanRaw) : null;
  const entitlementSource = normalizeEntitlementSource(
    typeof input.entitlementSource === 'string' ? input.entitlementSource : null,
  );
  const entitlementEndsAt = typeof input.entitlementEndsAt === 'string' ? input.entitlementEndsAt : null;
  const hasPaidBillingPlan = entitlementSource === 'paid' && entitlementPlan === 'pro';
  const hasPromoOnlyAccess =
    entitlementSource === 'promo' ||
    entitlementPlanRaw === 'promo_pro' ||
    mirroredPlanRaw === 'promo_pro' ||
    profileTierRaw === 'promo_pro';

  if (profileInfo.isAdmin) {
    return {
      plan: 'pro',
      isAdmin: true,
      hasPro: true,
      source: 'profile',
      entitlementSource: 'paid',
      expiresAt: null,
    };
  }

  if (profileInfo.plan === 'premium') {
    return {
      plan: 'premium',
      isAdmin: false,
      hasPro: true,
      source: 'profile',
      entitlementSource: 'paid',
      expiresAt: null,
    };
  }

  if (mirroredPlan === 'premium') {
    return {
      plan: 'premium',
      isAdmin: false,
      hasPro: true,
      source: 'au_user_entitlements',
      entitlementSource: mirroredSource === 'none' ? 'paid' : mirroredSource,
      expiresAt: mirroredExpiresAt,
    };
  }

  if (hasPaidBillingPlan) {
    return {
      plan: entitlementPlan || 'pro',
      isAdmin: false,
      hasPro: true,
      source: 'billing',
      entitlementSource,
      expiresAt: entitlementEndsAt,
    };
  }

  if (mirroredPlan) {
    return {
      plan: mirroredPlan,
      isAdmin: false,
      hasPro: mirroredPlan !== 'free',
      source: 'au_user_entitlements',
      entitlementSource: mirroredPlan === 'free' ? 'none' : (mirroredSource === 'none' ? 'paid' : mirroredSource),
      expiresAt: mirroredExpiresAt,
    };
  }

  if (profileInfo.plan) {
    return {
      plan: profileInfo.plan,
      isAdmin: false,
      hasPro: profileInfo.plan !== 'free',
      source: 'profile',
      entitlementSource: profileInfo.plan === 'free' ? 'none' : 'paid',
      expiresAt: null,
    };
  }

  if (hasPromoOnlyAccess) {
    return {
      plan: 'free',
      isAdmin: false,
      hasPro: false,
      source: 'billing',
      entitlementSource: 'promo',
      expiresAt: entitlementEndsAt,
    };
  }

  return {
    plan: 'free',
    isAdmin: false,
    hasPro: false,
    source: 'default',
    entitlementSource: 'none',
    expiresAt: null,
  };
}

export async function loadPlanLimitRules(
  supabase: SupabaseClient,
  plan: EffectivePlanCode,
): Promise<Record<ApprovedLimitKey, EffectivePlanLimitRule>> {
  const catalog = await loadPlanLimitCatalog(supabase);
  return catalog.effectiveRulesByPlan[plan];
}

export async function loadPlanLimits(
  supabase: SupabaseClient,
  plan: EffectivePlanCode,
): Promise<CanonicalPlanLimits> {
  const rules = await loadPlanLimitRules(supabase, plan);
  return ruleSetToNumericLimits(rules);
}

function serializePlanLimitPresentation(display: PlanLimitPresentation): SerializedPlanLimitPresentation {
  return {
    cap_label: display.capLabel,
    mode_label: display.modeLabel,
    reset_label: display.resetLabel,
    reset_description: display.resetDescription,
    summary: display.summary,
  };
}

export async function resolveEffectivePlanLimitSnapshot(input: {
  supabase: SupabaseClient;
  plan: EffectivePlanCode;
  userId?: string | null;
}): Promise<EffectivePlanLimitSnapshot> {
  const limitRules = await loadPlanLimitRules(input.supabase, input.plan);
  const usage = input.userId
    ? await buildUsageSnapshotForUser(input.supabase, input.userId, limitRules)
    : buildZeroUsageSnapshot(limitRules);
  return {
    plan: input.plan,
    limits: ruleSetToNumericLimits(limitRules),
    limitRules,
    usage,
  };
}

export async function loadPlanMetadata(
  supabase: SupabaseClient,
  plan: EffectivePlanCode,
): Promise<PlanMetadata> {
  await ensurePlanSeedRow(supabase, 'au_plans', plan).catch(() => undefined);
  await ensurePlanSeedRow(supabase, 'au_plan_metadata', plan).catch(() => undefined);

  const res = await supabase
    .from('au_plan_metadata')
    .select(
      'label,description,price_display,monthly_amount_ngn,monthly_compare_at_ngn,monthly_badge,weekly_amount_ngn,weekly_compare_at_ngn,weekly_badge,feature_bullets,cta_label,cta_href,sort_order,retention_days,expiration_days',
    )
    .eq('plan', plan)
    .maybeSingle();

  if (!res.error && res.data) return normalizePlanMetadata(plan, res.data);
  if (res.error && !isSchemaDriftError(res.error)) throw res.error;
  return { ...DEFAULT_PLAN_METADATA[plan] };
}

function toPricingPoint(
  amount: number | null,
  compareAt: number | null,
  label: string,
  planKey: string | null,
): PublicPlanPricing['monthly'] {
  if (amount === null || amount === undefined || amount <= 0) return null;
  return { amount, compare_at: compareAt, label, plan_key: planKey };
}

async function loadBillingPricingRows(supabase: SupabaseClient): Promise<BillingPricingRows> {
  const res = await supabase
    .from('billing_plans')
    .select('plan_key,interval,amount_kobo,is_active')
    .in('plan_key', ['pro_weekly', 'pro_monthly'])
    .eq('is_active', true);

  if (res.error) {
    if (isSchemaDriftError(res.error)) return {};
    throw res.error;
  }

  const out: BillingPricingRows = {};
  for (const row of res.data || []) {
    const intervalRaw = String((row as any)?.interval || '').trim().toLowerCase();
    const planKey = String((row as any)?.plan_key || '').trim();
    const amount = Math.round(Number((row as any)?.amount_kobo || 0) / 100);
    if ((intervalRaw !== 'monthly' && intervalRaw !== 'weekly') || !planKey || !Number.isFinite(amount)) continue;
    out[intervalRaw] = { amount: Math.max(0, amount), plan_key: planKey };
  }
  return out;
}

export async function loadPublicPlanCatalog(supabase: SupabaseClient): Promise<PublicPlanCatalogEntry[]> {
  const [plansRes, pricingRows] = await Promise.all([
    supabase.from('au_plans').select('plan,is_default'),
    loadBillingPricingRows(supabase).catch(() => ({} as BillingPricingRows)),
  ]);

  const planRows = !plansRes.error && plansRes.data?.length
    ? plansRes.data
    : DEFAULT_PLAN_ORDER.map((plan) => ({ plan, is_default: plan === 'free' }));

  const entries = await Promise.all(
    DEFAULT_PLAN_ORDER.map(async (plan) => {
      const metadata = await loadPlanMetadata(supabase, plan);
      const snapshot = await resolveEffectivePlanLimitSnapshot({ supabase, plan });
      const limitRules = snapshot.limitRules;
      const limits = snapshot.limits;
      const pricing: PublicPlanPricing = {
        monthly: plan === 'pro'
          ? toPricingPoint(
              pricingRows.monthly?.amount ?? metadata.monthly_amount_ngn,
              metadata.monthly_compare_at_ngn,
              metadata.monthly_badge,
              pricingRows.monthly?.plan_key ?? 'pro_monthly',
            )
          : toPricingPoint(metadata.monthly_amount_ngn, metadata.monthly_compare_at_ngn, metadata.monthly_badge, null),
        weekly: plan === 'pro'
          ? toPricingPoint(
              pricingRows.weekly?.amount ?? metadata.weekly_amount_ngn,
              metadata.weekly_compare_at_ngn,
              metadata.weekly_badge,
              pricingRows.weekly?.plan_key ?? 'pro_weekly',
            )
          : toPricingPoint(metadata.weekly_amount_ngn, metadata.weekly_compare_at_ngn, metadata.weekly_badge, null),
      };

      return {
        plan,
        isDefault: Boolean(planRows.find((row: any) => String(row?.plan || '').trim().toLowerCase() === plan)?.is_default ?? (plan === 'free')),
        metadata: {
          ...metadata,
          price_display:
            plan === 'pro' && pricing.monthly && pricing.weekly
              ? `NGN ${pricing.monthly.amount.toLocaleString()}/month or NGN ${pricing.weekly.amount.toLocaleString()}/week`
              : metadata.price_display,
        },
        pricing,
        limits,
        limitRules,
        resetLabels: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
          acc[key] = snapshot.usage.windows[key]?.label || describeResetPolicy(limitRules[key]);
          return acc;
        }, {} as Record<ApprovedLimitKey, string>),
      } satisfies PublicPlanCatalogEntry;
    }),
  );

  return entries.sort((a, b) => {
    if (a.metadata.sort_order !== b.metadata.sort_order) return a.metadata.sort_order - b.metadata.sort_order;
    return DEFAULT_PLAN_ORDER.indexOf(a.plan) - DEFAULT_PLAN_ORDER.indexOf(b.plan);
  });
}

async function safeExactCount(
  supabase: SupabaseClient,
  table: string,
  options: {
    userId?: string;
    ownerOrUser?: boolean;
    featureFilter?: string;
    featureValues?: string[];
    statuses?: string[];
    startIso?: string;
    endIso?: string | null;
    createdAtColumn?: string;
  } = {},
): Promise<number> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });

  if (options.ownerOrUser && options.userId) {
    query = query.or(`owner_id.eq.${options.userId},user_id.eq.${options.userId}`);
  } else if (options.userId) {
    query = query.eq('user_id', options.userId);
  }

  if (options.featureFilter) query = query.eq('feature', options.featureFilter);
  if (options.featureValues && options.featureValues.length > 0) query = query.in('feature', options.featureValues);
  if (options.statuses && options.statuses.length > 0) query = query.in('status', options.statuses);

  const createdAtColumn = options.createdAtColumn || 'created_at';
  if (options.startIso) query = query.gte(createdAtColumn, options.startIso);
  if (options.endIso) query = query.lt(createdAtColumn, options.endIso);

  const { count, error } = await query;
  if (error) {
    if (isSchemaDriftError(error)) return 0;
    throw error;
  }
  return Number(count || 0);
}

async function safeTokenUsage(
  supabase: SupabaseClient,
  userId: string,
  window: { windowStart: string; windowEnd: string | null },
): Promise<number> {
  let query = supabase
    .from('au_model_usage')
    .select('total_tokens,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10_000);

  query = query.gte('created_at', window.windowStart);
  if (window.windowEnd) query = query.lt('created_at', window.windowEnd);

  const { data, error } = await query;
  if (error) {
    if (isSchemaDriftError(error)) return 0;
    throw error;
  }

  return (data || []).reduce((sum, row) => sum + clampNonNegativeNumber((row as any)?.total_tokens, 0), 0);
}

function isCountedDocument(row: Pick<DocumentUsageRow, 'status'>): boolean {
  return String(row.status || '').trim().toLowerCase() !== 'failed';
}

function countCurrentDocuments(rows: DocumentUsageRow[]): number {
  return rows.reduce((sum, row) => sum + (isCountedDocument(row) ? 1 : 0), 0);
}

function countDocumentsWithinWindow(
  rows: DocumentUsageRow[],
  window: { windowStart: string; windowEnd: string | null },
): number {
  return rows.reduce((sum, row) => {
    if (!isCountedDocument(row)) return sum;
    const createdAt = row.created_at;
    if (!createdAt || createdAt < window.windowStart) return sum;
    if (window.windowEnd && createdAt >= window.windowEnd) return sum;
    return sum + 1;
  }, 0);
}

export function buildZeroUsageSnapshot(
  limitRules: Record<ApprovedLimitKey, EffectivePlanLimitRule>,
): EffectiveUsage {
  const by_limit = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    const window = computeResetWindow(limitRules[key]);
    acc[key] = {
      key,
      used: 0,
      limit: getLimitCap(limitRules[key]),
      remaining: getLimitCap(limitRules[key]),
      state: limitRules[key].state,
      mode: limitRules[key].mode,
      label: limitRules[key].label,
      description: limitRules[key].description,
      category: limitRules[key].category,
      reset: {
        policy: window.policy,
        intervalValue: window.intervalValue,
        intervalUnit: window.intervalUnit,
        window_start: window.windowStart,
        window_end: window.windowEnd,
        label: window.label,
      },
    };
    return acc;
  }, {} as Record<ApprovedLimitKey, LimitUsageSnapshot>);

  const windows = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    acc[key] = by_limit[key].reset;
    return acc;
  }, {} as Record<ApprovedLimitKey, LimitUsageSnapshot['reset']>);

  return {
    today: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {} as Record<ApprovedLimitKey, number>),
    total: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {} as Record<ApprovedLimitKey, number>),
    by_limit,
    windows,
    reset_policies: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
      acc[key] = by_limit[key].reset.policy;
      return acc;
    }, {} as Record<ApprovedLimitKey, PlanLimitResetPolicy>),
    reset_at: APPROVED_LIMIT_KEYS
      .map((key) => by_limit[key].reset.window_end)
      .filter((value): value is string => Boolean(value))
      .sort()[0] || null,
  };
}

export async function buildUsageSnapshotForUser(
  supabase: SupabaseClient,
  userId: string,
  limitRules: Record<ApprovedLimitKey, EffectivePlanLimitRule>,
): Promise<EffectiveUsage> {
  const uploadWindow = computeResetWindow(limitRules.max_uploads_total);
  const predictionWindow = computeResetWindow(limitRules.max_exam_predictions);
  const practiceWindow = computeResetWindow(limitRules.max_practice_exams);
  const knowledgeWindow = computeResetWindow(limitRules.max_knowledge_hub);
  const chatWindow = computeResetWindow(limitRules.max_chats_total);
  const tokenWindow = computeResetWindow(limitRules.max_tokens_total);

  const [
    documentRows,
    runningJobs,
    legacyChatsCount,
    legacyTokensUsed,
    predictionWindowCount,
    predictionCurrentCount,
    practiceWindowCount,
    practiceCurrentCount,
    knowledgeWindowCount,
    knowledgeCurrentCount,
    trackedSnapshots,
  ] = await Promise.all([
    safeSelectDocuments(supabase, userId),
    safeExactCount(supabase, 'au_worker_jobs', {
      userId,
      ownerOrUser: true,
      statuses: ['queued', 'uploaded', 'processing'],
    }),
    safeExactCount(supabase, 'au_messages', {
      userId,
      startIso: chatWindow.windowStart,
      endIso: chatWindow.windowEnd,
    }),
    safeTokenUsage(supabase, userId, tokenWindow),
    safeExactCount(supabase, 'au_feature_outputs', {
      userId,
      featureValues: ['exam_prediction'],
      statuses: ['ready', 'running'],
      startIso: predictionWindow.windowStart,
      endIso: predictionWindow.windowEnd,
    }),
    safeExactCount(supabase, 'au_feature_outputs', {
      userId,
      featureValues: ['exam_prediction'],
      statuses: ['ready', 'running'],
    }),
    safeExactCount(supabase, 'au_feature_outputs', {
      userId,
      featureValues: ['practice_exam_generation', 'practice_exam_generation_pack2'],
      statuses: ['ready', 'running'],
      startIso: practiceWindow.windowStart,
      endIso: practiceWindow.windowEnd,
    }),
    safeExactCount(supabase, 'au_feature_outputs', {
      userId,
      featureValues: ['practice_exam_generation', 'practice_exam_generation_pack2'],
      statuses: ['ready', 'running'],
    }),
    safeExactCount(supabase, 'au_feature_outputs', {
      userId,
      featureValues: ['knowledge_hub'],
      statuses: ['ready', 'running'],
      startIso: knowledgeWindow.windowStart,
      endIso: knowledgeWindow.windowEnd,
    }),
    safeExactCount(supabase, 'au_feature_outputs', {
      userId,
      featureValues: ['knowledge_hub'],
      statuses: ['ready', 'running'],
    }),
    loadUsageCounterSnapshots(supabase, userId).catch(() => ({ today: {}, total: {} })),
  ]);

  const currentUploads = countCurrentDocuments(documentRows);
  const windowUploads = countDocumentsWithinWindow(documentRows, uploadWindow);

  const [
    trackedChats,
    trackedTokens,
    trackedUploads,
    trackedPredictions,
    trackedPractice,
    trackedKnowledge,
  ] = await Promise.all([
    resolveUsageMetricForRule({
      supabase,
      userId,
      metricKey: 'max_chats_total',
      rule: limitRules.max_chats_total,
      fallbackUsed: legacyChatsCount,
      todayCounters: trackedSnapshots.today,
      totalCounters: trackedSnapshots.total,
    }),
    resolveUsageMetricForRule({
      supabase,
      userId,
      metricKey: 'max_tokens_total',
      rule: limitRules.max_tokens_total,
      fallbackUsed: legacyTokensUsed,
      todayCounters: trackedSnapshots.today,
      totalCounters: trackedSnapshots.total,
    }),
    resolveUsageMetricForRule({
      supabase,
      userId,
      metricKey: 'max_uploads_total',
      rule: limitRules.max_uploads_total,
      fallbackUsed: limitRules.max_uploads_total.mode === 'current' ? currentUploads : windowUploads,
      todayCounters: trackedSnapshots.today,
      totalCounters: trackedSnapshots.total,
    }),
    resolveUsageMetricForRule({
      supabase,
      userId,
      metricKey: 'max_exam_predictions',
      rule: limitRules.max_exam_predictions,
      fallbackUsed: limitRules.max_exam_predictions.mode === 'current' ? predictionCurrentCount : predictionWindowCount,
      todayCounters: trackedSnapshots.today,
      totalCounters: trackedSnapshots.total,
    }),
    resolveUsageMetricForRule({
      supabase,
      userId,
      metricKey: 'max_practice_exams',
      rule: limitRules.max_practice_exams,
      fallbackUsed: limitRules.max_practice_exams.mode === 'current' ? practiceCurrentCount : practiceWindowCount,
      todayCounters: trackedSnapshots.today,
      totalCounters: trackedSnapshots.total,
    }),
    resolveUsageMetricForRule({
      supabase,
      userId,
      metricKey: 'max_knowledge_hub',
      rule: limitRules.max_knowledge_hub,
      fallbackUsed: limitRules.max_knowledge_hub.mode === 'current' ? knowledgeCurrentCount : knowledgeWindowCount,
      todayCounters: trackedSnapshots.today,
      totalCounters: trackedSnapshots.total,
    }),
  ]);

  const totals = {
    max_chats_total: trackedChats.effectiveUsed,
    max_uploads_total: trackedUploads.effectiveUsed,
    max_tokens_total: trackedTokens.effectiveUsed,
    max_file_size_mb: 0,
    max_concurrent_jobs: runningJobs,
    max_exam_predictions: trackedPredictions.effectiveUsed,
    max_practice_exams: trackedPractice.effectiveUsed,
    max_knowledge_hub: trackedKnowledge.effectiveUsed,
  } satisfies Record<ApprovedLimitKey, number>;

  const by_limit = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    const window = computeResetWindow(limitRules[key]);
    const cap = getLimitCap(limitRules[key]);
    const used = totals[key];
    acc[key] = {
      key,
      used,
      limit: cap,
      remaining: cap === null ? null : Math.max(0, cap - used),
      state: limitRules[key].state,
      mode: limitRules[key].mode,
      label: limitRules[key].label,
      description: limitRules[key].description,
      category: limitRules[key].category,
      reset: {
        policy: window.policy,
        intervalValue: window.intervalValue,
        intervalUnit: window.intervalUnit,
        window_start: window.windowStart,
        window_end: window.windowEnd,
        label: window.label,
      },
    };
    return acc;
  }, {} as Record<ApprovedLimitKey, LimitUsageSnapshot>);

  const windows = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    acc[key] = by_limit[key].reset;
    return acc;
  }, {} as Record<ApprovedLimitKey, LimitUsageSnapshot['reset']>);

  return {
    today: { ...totals },
    total: { ...totals },
    by_limit,
    windows,
    reset_policies: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
      acc[key] = by_limit[key].reset.policy;
      return acc;
    }, {} as Record<ApprovedLimitKey, PlanLimitResetPolicy>),
    reset_at: APPROVED_LIMIT_KEYS
      .map((key) => by_limit[key].reset.window_end)
      .filter((value): value is string => Boolean(value))
      .sort()[0] || null,
  };
}

export async function getEffectiveLimits(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectiveLimitsResult> {
  const effectivePlan = await resolveEffectivePlan(supabase, userId);
  const snapshot = await resolveEffectivePlanLimitSnapshot({
    supabase,
    plan: effectivePlan.plan,
    userId,
  });
  return {
    plan: effectivePlan.plan,
    effectivePlan,
    limits: snapshot.limits,
    limitRules: snapshot.limitRules,
    usage: snapshot.usage,
  };
}

function buildLimitPayload(params: {
  status: number;
  code: string;
  message: string;
  limit: ApprovedLimitKey;
  current: number;
  max?: number | null;
  action: string;
  correlationId: string;
  resetAt?: string | null;
}): LimitPayload {
  return {
    status: params.status,
    code: params.code,
    message: params.message,
    limit: params.limit,
    current: params.current,
    used: params.current,
    max: params.max ?? null,
    action: params.action,
    correlation_id: params.correlationId,
    reset_at: params.resetAt || null,
  };
}

function assertRuleEnabled(
  rule: EffectivePlanLimitRule,
  action: string,
  correlationId: string,
  current = 0,
): void {
  if (rule.isEnabled) return;
  throw new EffectiveLimitError(
    403,
    buildLimitPayload({
      status: 403,
      code: 'LIMIT_REACHED',
      message: `${rule.label} is disabled for this plan.`,
      limit: rule.key,
      current,
      max: getLimitCap(rule),
      action,
      correlationId,
      resetAt: null,
    }),
  );
}

function assertUsageWithinCap(params: {
  rule: EffectivePlanLimitRule;
  used: number;
  nextIncrement?: number;
  action: string;
  message: string;
  correlationId: string;
  resetAt?: string | null;
  status?: number;
  code?: string;
  headers?: Record<string, string>;
}): void {
  const cap = getLimitCap(params.rule);
  assertRuleEnabled(params.rule, params.action, params.correlationId, params.used);
  if (cap === null) return;
  const nextUsed = params.used + (params.nextIncrement ?? 0);
  if (nextUsed <= cap) return;
  throw new EffectiveLimitError(
    params.status || 403,
    buildLimitPayload({
      status: params.status || 403,
      code: params.code || 'LIMIT_REACHED',
      message: params.message,
      limit: params.rule.key,
      current: params.used,
      max: cap,
      action: params.action,
      correlationId: params.correlationId,
      resetAt: params.resetAt ?? null,
    }),
    params.headers,
  );
}

export function throwUploadLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  fileSizeBytes: number;
  correlationId: string;
  includeUploadCount?: boolean;
}): void {
  const fileRule = input.limits.limitRules.max_file_size_mb;
  const uploadRule = input.limits.limitRules.max_uploads_total;
  const fileSizeMb = Math.ceil(input.fileSizeBytes / ONE_MB_BYTES);
  const cap = getLimitCap(fileRule);

  assertRuleEnabled(fileRule, 'upload_init', input.correlationId, fileSizeMb);
  if (cap !== null && fileSizeMb > cap) {
    throw new EffectiveLimitError(
      413,
      buildLimitPayload({
        status: 413,
        code: 'LIMIT_EXCEEDED',
        message: cap <= 50 && fileSizeMb > 50 ? LARGE_FILE_DISABLED_MESSAGE : `File exceeds upload size limit (${cap}MB).`,
        limit: 'max_file_size_mb',
        current: fileSizeMb,
        max: cap,
        action: 'upload_init',
        correlationId: input.correlationId,
      }),
    );
  }

  if (input.includeUploadCount !== false) {
    assertUsageWithinCap({
      rule: uploadRule,
      used: clampNonNegativeNumber(input.limits.usage.total.max_uploads_total, 0),
      nextIncrement: 1,
      action: 'upload_init',
      correlationId: input.correlationId,
      resetAt: input.limits.usage.by_limit.max_uploads_total.reset.window_end,
      message:
        uploadRule.mode === 'current'
          ? 'Stored upload limit reached for this account. Delete an upload before adding another.'
          : 'Upload quota reached for this account.',
    });
  }
}

export function throwIngestLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
}): void {
  assertUsageWithinCap({
    rule: input.limits.limitRules.max_concurrent_jobs,
    used: clampNonNegativeNumber(input.limits.usage.total.max_concurrent_jobs, 0),
    nextIncrement: 0,
    action: 'document_ingest',
    correlationId: input.correlationId,
    message: 'Too many active jobs. Retry after an active job completes.',
    status: 429,
    headers: { 'retry-after': '60' },
  });
}

export function throwChatLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
  tokenIncrement?: number;
}): void {
  assertUsageWithinCap({
    rule: input.limits.limitRules.max_chats_total,
    used: clampNonNegativeNumber(input.limits.usage.total.max_chats_total, 0),
    nextIncrement: 1,
    action: 'chat',
    correlationId: input.correlationId,
    resetAt: input.limits.usage.by_limit.max_chats_total.reset.window_end,
    message: 'Chat limit reached for this account.',
  });

  assertUsageWithinCap({
    rule: input.limits.limitRules.max_tokens_total,
    used: clampNonNegativeNumber(input.limits.usage.total.max_tokens_total, 0),
    nextIncrement: Math.max(0, Math.floor(Number(input.tokenIncrement || 0))),
    action: 'chat',
    correlationId: input.correlationId,
    resetAt: input.limits.usage.by_limit.max_tokens_total.reset.window_end,
    message: 'Token budget exceeded for the current quota window. Retry after reset.',
    status: 429,
    code: 'TOKEN_BUDGET_EXCEEDED',
    headers: { 'retry-after': '3600' },
  });
}

export function throwExamPredictionLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
  action?: string;
}): void {
  assertUsageWithinCap({
    rule: input.limits.limitRules.max_exam_predictions,
    used: clampNonNegativeNumber(input.limits.usage.total.max_exam_predictions, 0),
    nextIncrement: 1,
    action: input.action || 'exam_prediction',
    correlationId: input.correlationId,
    resetAt: input.limits.usage.by_limit.max_exam_predictions.reset.window_end,
    message: 'Exam prediction limit reached for this account.',
  });
}

export function throwPracticeExamLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
  action?: string;
}): void {
  assertUsageWithinCap({
    rule: input.limits.limitRules.max_practice_exams,
    used: clampNonNegativeNumber(input.limits.usage.total.max_practice_exams, 0),
    nextIncrement: 1,
    action: input.action || 'practice_exam_generation',
    correlationId: input.correlationId,
    resetAt: input.limits.usage.by_limit.max_practice_exams.reset.window_end,
    message: 'Practice exam limit reached for this account.',
  });
}

export function throwKnowledgeHubLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
  action?: string;
}): void {
  assertUsageWithinCap({
    rule: input.limits.limitRules.max_knowledge_hub,
    used: clampNonNegativeNumber(input.limits.usage.total.max_knowledge_hub, 0),
    nextIncrement: 1,
    action: input.action || 'knowledge_hub',
    correlationId: input.correlationId,
    resetAt: input.limits.usage.by_limit.max_knowledge_hub.reset.window_end,
    message:
      input.limits.limitRules.max_knowledge_hub.mode === 'current'
        ? 'Knowledge Hub item limit reached for this account. Clear a stored item before generating another.'
        : 'Knowledge Hub generation limit reached for this account.',
  });
}

export async function loadAdminPlanLimitState(supabase: SupabaseClient): Promise<{
  source: PlanLimitCatalog['source'];
  defaultRules: Record<ApprovedLimitKey, StoredPlanLimitRule>;
  storedRulesByScope: Record<PlanLimitScopeKey, Partial<Record<ApprovedLimitKey, StoredPlanLimitRule>>>;
  effectiveRulesByPlan: Record<EffectivePlanCode, Record<ApprovedLimitKey, EffectivePlanLimitRule>>;
}> {
  const catalog = await loadPlanLimitCatalog(supabase);
  return {
    source: catalog.source,
    defaultRules: catalog.defaultRules,
    storedRulesByScope: catalog.storedRulesByScope,
    effectiveRulesByPlan: catalog.effectiveRulesByPlan,
  };
}

export async function savePlanLimitScopeRules(input: {
  supabase: SupabaseClient;
  scope: PlanLimitScopeKey;
  rules: Record<ApprovedLimitKey, StoredPlanLimitRule | null>;
}): Promise<void> {
  const defaultRules = buildDefaultRuleSet();
  const removeKeys = APPROVED_LIMIT_KEYS.filter((key) => input.scope !== 'default' && !input.rules[key]);
  const upsertRows = APPROVED_LIMIT_KEYS
    .map((key) => input.rules[key])
    .filter((rule): rule is StoredPlanLimitRule => Boolean(rule))
    .map((rule) => buildRuleRowPayload(input.scope, rule));

  if (removeKeys.length > 0) {
    const deleteRes = await input.supabase.from('au_plan_limit_rules').delete().eq('scope', input.scope).in('limit_key', removeKeys);
    if (deleteRes.error) {
      if (isSchemaDriftError(deleteRes.error)) {
        throw new Error(
          'Missing canonical plan-limits schema. Run `npm run supabase:db:push` to apply the latest backend migration before saving limits.',
        );
      }
      throw deleteRes.error;
    }
  }

  if (upsertRows.length > 0) {
    const upsertRes = await input.supabase.from('au_plan_limit_rules').upsert(upsertRows, { onConflict: 'scope,limit_key' });
    if (upsertRes.error) {
      if (isSchemaDriftError(upsertRes.error)) {
        throw new Error(
          'Missing canonical plan-limits schema. Run `npm run supabase:db:push` to apply the latest backend migration before saving limits.',
        );
      }
      throw upsertRes.error;
    }
  }

  if (input.scope === 'default') {
    for (const key of APPROVED_LIMIT_KEYS) {
      if (!input.rules[key]) {
        const fallback = buildRuleRowPayload('default', defaultRules[key]);
        const fallbackRes = await input.supabase.from('au_plan_limit_rules').upsert(fallback, { onConflict: 'scope,limit_key' });
        if (fallbackRes.error && !isSchemaDriftError(fallbackRes.error)) throw fallbackRes.error;
      }
    }
  }
}

export function toStoredPlanRuleSetForScope(input: {
  scope: PlanLimitScopeKey;
  defaultRules: Record<ApprovedLimitKey, StoredPlanLimitRule>;
  ruleInputs: Record<ApprovedLimitKey, { inheritsDefault?: boolean } & Partial<StoredPlanLimitRule>>;
}): Record<ApprovedLimitKey, StoredPlanLimitRule | null> {
  return APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    const raw = input.ruleInputs[key] || {};
    if (input.scope !== 'default' && raw.inheritsDefault) {
      acc[key] = null;
      return acc;
    }
    const normalized = normalizeStoredPlanLimitRule(key, raw, input.defaultRules[key]);
    if (
      input.scope !== 'default' &&
      normalized.value === input.defaultRules[key].value &&
      normalized.mode === input.defaultRules[key].mode &&
      normalized.resetPolicy === input.defaultRules[key].resetPolicy &&
      normalized.resetIntervalValue === input.defaultRules[key].resetIntervalValue &&
      normalized.resetIntervalUnit === input.defaultRules[key].resetIntervalUnit &&
      normalized.isEnabled === input.defaultRules[key].isEnabled &&
      normalized.isUnlimited === input.defaultRules[key].isUnlimited
    ) {
      acc[key] = null;
      return acc;
    }
    acc[key] = normalized;
    return acc;
  }, {} as Record<ApprovedLimitKey, StoredPlanLimitRule | null>);
}

export function serializeEffectivePlanLimitRule(rule: EffectivePlanLimitRule) {
  const presentation = buildPlanLimitPresentation({
    value: rule.value,
    isEnabled: rule.isEnabled,
    isUnlimited: rule.isUnlimited,
    mode: rule.mode,
    resetPolicy: rule.resetPolicy,
    resetIntervalValue: rule.resetIntervalValue,
    resetIntervalUnit: rule.resetIntervalUnit,
    unitLabel: rule.unitLabel,
    category: rule.category,
  });
  return {
    key: rule.key,
    label: rule.label,
    description: rule.description,
    unit_label: rule.unitLabel,
    category: rule.category,
    value: rule.value,
    mode: rule.mode,
    reset_policy: rule.resetPolicy,
    reset_interval_value: rule.resetIntervalValue,
    reset_interval_unit: rule.resetIntervalUnit,
    is_enabled: rule.isEnabled,
    is_unlimited: rule.isUnlimited,
    state: rule.state,
    inherited: rule.inherited,
    source_scope: rule.sourceScope,
    updated_at: rule.updatedAt,
    enforced_by: [...rule.enforcedBy],
    presentation: serializePlanLimitPresentation(presentation),
  };
}

export function serializeStoredPlanLimitRule(rule: StoredPlanLimitRule | null) {
  if (!rule) return null;
  const definition = PLAN_LIMIT_DEFINITIONS[rule.key];
  const presentation = buildPlanLimitPresentation({
    value: rule.value,
    isEnabled: rule.isEnabled,
    isUnlimited: rule.isUnlimited,
    mode: rule.mode,
    resetPolicy: rule.resetPolicy,
    resetIntervalValue: rule.resetIntervalValue,
    resetIntervalUnit: rule.resetIntervalUnit,
    unitLabel: definition.unitLabel,
    category: definition.category,
  });
  return {
    key: rule.key,
    label: definition.label,
    description: definition.description,
    unit_label: definition.unitLabel,
    category: definition.category,
    value: rule.value,
    mode: rule.mode,
    reset_policy: rule.resetPolicy,
    reset_interval_value: rule.resetIntervalValue,
    reset_interval_unit: rule.resetIntervalUnit,
    is_enabled: rule.isEnabled,
    is_unlimited: rule.isUnlimited,
    state: rule.isEnabled ? (rule.isUnlimited ? 'unlimited' : 'capped') : 'disabled',
    updated_at: rule.updatedAt,
    enforced_by: [...definition.enforcedBy],
    presentation: serializePlanLimitPresentation(presentation),
  };
}

export function describeLimitScope(scope: PlanLimitScopeKey): string {
  return formatScopeLabel(scope);
}
