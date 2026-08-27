import assert from 'node:assert/strict';
import {
  APPROVED_LIMIT_KEYS,
  DEFAULT_PLAN_ORDER,
  buildDefaultRuleSet,
  buildSeedPlanRuleSet,
  type ApprovedLimitKey,
  type EffectivePlanCode,
  type StoredPlanLimitRule,
} from '../src/lib/limits/plan-limit-model.js';
import {
  type EffectiveLimitsResult,
  EffectiveLimitError,
  loadAdminPlanLimitState,
  resolveCanonicalEffectiveLimits,
  resolveEffectivePlanFromInputs,
  resolveEffectivePlanLimitSnapshot,
  savePlanLimitScopeRules,
  serializeEffectivePlanLimitRule,
  throwUploadLimitIfNeeded,
} from '../src/lib/server/au-limits.js';

let failed = 0;

type SyncOrAsyncTest = () => void | Promise<void>;

type PlanLimitRow = {
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

type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] };

async function run(name: string, fn: SyncOrAsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function toRuleRow(scope: string, rule: StoredPlanLimitRule): PlanLimitRow {
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
    updated_at: rule.updatedAt,
  };
}

function applyFilters(rows: PlanLimitRow[], filters: Filter[]): PlanLimitRow[] {
  return rows.filter((row) => {
    for (const filter of filters) {
      const value = (row as Record<string, unknown>)[filter.column];
      if (filter.kind === 'eq' && value !== filter.value) return false;
      if (filter.kind === 'in' && !filter.values.includes(value)) return false;
    }
    return true;
  });
}

class PlanLimitQueryBuilder {
  private action: 'select' | 'delete' = 'select';
  private filters: Filter[] = [];
  private selectOptions: Record<string, unknown> | null = null;

  constructor(private readonly rows: PlanLimitRow[]) {}

  select(_columns: string, options?: Record<string, unknown>) {
    this.action = 'select';
    this.selectOptions = options || null;
    return this;
  }

  delete() {
    this.action = 'delete';
    this.selectOptions = null;
    return this;
  }

  async upsert(payload: PlanLimitRow | PlanLimitRow[]) {
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const row of rows) {
      const index = this.rows.findIndex((entry) => entry.scope === row.scope && entry.limit_key === row.limit_key);
      if (index >= 0) {
        this.rows[index] = { ...this.rows[index], ...row };
      } else {
        this.rows.push({ ...row });
      }
    }
    return { data: null, error: null };
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ kind: 'in', column, values });
    return this;
  }

  async maybeSingle() {
    const filtered = applyFilters(this.rows, this.filters);
    return {
      data: filtered[0] || null,
      error: null,
    };
  }

  then(resolve: (value: any) => void, reject?: (reason?: any) => void) {
    try {
      const filtered = applyFilters(this.rows, this.filters);
      if (this.action === 'delete') {
        for (const row of filtered) {
          const index = this.rows.indexOf(row);
          if (index >= 0) this.rows.splice(index, 1);
        }
        resolve({ data: null, error: null });
        return;
      }

      const wantsHead = this.selectOptions?.head === true;
      resolve({
        data: wantsHead ? null : filtered.map((row) => ({ ...row })),
        error: null,
        count: wantsHead ? filtered.length : null,
      });
    } catch (error) {
      if (reject) {
        reject(error);
        return;
      }
      throw error;
    }
  }
}

class FakePlanLimitSupabase {
  private readonly rows: PlanLimitRow[];

  constructor(seedRows: PlanLimitRow[]) {
    this.rows = seedRows.map((row) => ({ ...row }));
  }

  from(table: string) {
    assert.equal(table, 'au_plan_limit_rules');
    return new PlanLimitQueryBuilder(this.rows);
  }
}

function createSupabaseStub(): any {
  const defaultRules = buildDefaultRuleSet();
  const rows: PlanLimitRow[] = [];

  for (const rule of Object.values(defaultRules)) {
    rows.push(toRuleRow('default', rule));
  }

  for (const plan of DEFAULT_PLAN_ORDER) {
    const seedRules = buildSeedPlanRuleSet(plan);
    for (const key of APPROVED_LIMIT_KEYS) {
      rows.push(toRuleRow(plan, seedRules[key]));
    }
  }

  const supabase = new FakePlanLimitSupabase(rows);
  return supabase;
}

function createRuleMap(
  plan: EffectivePlanCode,
  state: Awaited<ReturnType<typeof loadAdminPlanLimitState>>,
): Record<ApprovedLimitKey, StoredPlanLimitRule | null> {
  const seeded = buildSeedPlanRuleSet(plan);
  return APPROVED_LIMIT_KEYS.reduce((acc, key) => {
    acc[key] = state.storedRulesByScope[plan][key] || seeded[key];
    return acc;
  }, {} as Record<ApprovedLimitKey, StoredPlanLimitRule | null>);
}

function toEffectiveLimitsResult(
  snapshot: Awaited<ReturnType<typeof resolveEffectivePlanLimitSnapshot>>,
): EffectiveLimitsResult {
  return {
    plan: snapshot.plan,
    effectivePlan: {
      plan: snapshot.plan,
      isAdmin: false,
      hasPro: snapshot.plan !== 'free',
      source: 'default',
      entitlementSource: snapshot.plan === 'free' ? 'none' : 'paid',
      expiresAt: null,
    },
    limits: snapshot.limits,
    limitRules: snapshot.limitRules,
    usage: snapshot.usage,
  };
}

async function main() {
  await run('promo-only entitlements keep users on free limits while paid Pro still resolves to Pro', async () => {
    const promoPlan = resolveEffectivePlanFromInputs({
      profileTier: 'free',
      mirroredPlan: 'free',
      mirroredSource: 'none',
      mirroredExpiresAt: null,
      entitlementPlan: 'promo_pro',
      entitlementSource: 'promo',
      entitlementEndsAt: '2099-04-01T23:00:00.000Z',
    });
    assert.equal(promoPlan.plan, 'free');
    assert.equal(promoPlan.entitlementSource, 'none');

    const promoFallbackPlan = resolveEffectivePlanFromInputs({
      profileTier: null,
      mirroredPlan: null,
      mirroredSource: null,
      mirroredExpiresAt: null,
      entitlementPlan: 'promo_pro',
      entitlementSource: 'promo',
      entitlementEndsAt: '2099-04-01T23:00:00.000Z',
    });
    assert.equal(promoFallbackPlan.plan, 'free');
    assert.equal(promoFallbackPlan.source, 'billing');
    assert.equal(promoFallbackPlan.entitlementSource, 'promo');

    const paidPlan = resolveEffectivePlanFromInputs({
      profileTier: 'free',
      mirroredPlan: null,
      mirroredSource: 'none',
      mirroredExpiresAt: null,
      entitlementPlan: 'pro',
      entitlementSource: 'paid',
      entitlementEndsAt: '2099-04-18T00:00:00.000Z',
    });
    assert.equal(paidPlan.plan, 'pro');
    assert.equal(paidPlan.source, 'billing');
    assert.equal(paidPlan.entitlementSource, 'paid');
  });

  await run('saving plan limits updates the canonical effective snapshot used by preview and user reads', async () => {
    const supabase = createSupabaseStub();
    const before = await resolveEffectivePlanLimitSnapshot({ supabase, plan: 'pro' });
    assert.equal(before.limits.max_chats_total, 30000);
    assert.equal(before.limits.max_file_size_mb, 50);

    const state = await loadAdminPlanLimitState(supabase);
    const nextRules = createRuleMap('pro', state);
    nextRules.max_chats_total = {
      ...(nextRules.max_chats_total as StoredPlanLimitRule),
      value: 42000,
      mode: 'usage',
      resetPolicy: 'weekly',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      isEnabled: true,
      isUnlimited: false,
      updatedAt: '2026-03-18T12:30:00.000Z',
    };
    nextRules.max_file_size_mb = {
      ...(nextRules.max_file_size_mb as StoredPlanLimitRule),
      value: 75,
      mode: 'per_request',
      resetPolicy: 'never',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      isEnabled: true,
      isUnlimited: false,
      updatedAt: '2026-03-18T12:30:00.000Z',
    };

    await savePlanLimitScopeRules({
      supabase,
      scope: 'pro',
      rules: nextRules,
    });

    const reloaded = await loadAdminPlanLimitState(supabase);
    const snapshot = await resolveEffectivePlanLimitSnapshot({ supabase, plan: 'pro' });
    const chatsRule = serializeEffectivePlanLimitRule(snapshot.limitRules.max_chats_total);
    const fileRule = serializeEffectivePlanLimitRule(snapshot.limitRules.max_file_size_mb);

    assert.equal(reloaded.effectiveRulesByPlan.pro.max_chats_total.value, 42000);
    assert.equal(reloaded.effectiveRulesByPlan.pro.max_file_size_mb.value, 75);
    assert.equal(snapshot.limits.max_chats_total, 42000);
    assert.equal(snapshot.limits.max_file_size_mb, 75);
    assert.equal(chatsRule.presentation?.summary, '42,000 messages / Usage-based / Weekly');
    assert.equal(fileRule.presentation?.summary, '75 MB / Per request / No reset');
    assert.equal(fileRule.presentation?.reset_description, 'Checked on every request. It does not use a scheduled reset window.');
  });

  await run('canonical effective limits resolver powers admin preview plan overrides from the same stored rules', async () => {
    const supabase = createSupabaseStub();
    const state = await loadAdminPlanLimitState(supabase);
    const nextRules = createRuleMap('pro', state);
    nextRules.max_chats_total = {
      ...(nextRules.max_chats_total as StoredPlanLimitRule),
      value: 42000,
      mode: 'usage',
      resetPolicy: 'weekly',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      isEnabled: true,
      isUnlimited: false,
      updatedAt: '2026-03-18T12:40:00.000Z',
    };
    nextRules.max_file_size_mb = {
      ...(nextRules.max_file_size_mb as StoredPlanLimitRule),
      value: 75,
      mode: 'per_request',
      resetPolicy: 'never',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      isEnabled: true,
      isUnlimited: false,
      updatedAt: '2026-03-18T12:40:00.000Z',
    };

    await savePlanLimitScopeRules({
      supabase,
      scope: 'pro',
      rules: nextRules,
    });

    const resolved = await resolveCanonicalEffectiveLimits({
      supabase,
      planOverride: 'pro',
    });

    assert.equal(resolved.plan, 'pro');
    assert.equal(resolved.effectivePlan.plan, 'pro');
    assert.equal(resolved.effectivePlan.source, 'default');
    assert.equal(resolved.limits.max_chats_total, 42000);
    assert.equal(resolved.limits.max_file_size_mb, 75);
    assert.equal(resolved.limitRules.max_chats_total.resetPolicy, 'weekly');
    assert.equal(resolved.usage.by_limit.max_chats_total.used, 0);
    assert.equal(resolved.usage.by_limit.max_file_size_mb.limit, 75);
  });

  await run('upload enforcement reads the same persisted canonical file-size rule', async () => {
    const supabase = createSupabaseStub();
    const state = await loadAdminPlanLimitState(supabase);
    const nextRules = createRuleMap('pro', state);
    nextRules.max_file_size_mb = {
      ...(nextRules.max_file_size_mb as StoredPlanLimitRule),
      value: 75,
      mode: 'per_request',
      resetPolicy: 'never',
      resetIntervalValue: null,
      resetIntervalUnit: null,
      isEnabled: true,
      isUnlimited: false,
      updatedAt: '2026-03-18T12:35:00.000Z',
    };

    await savePlanLimitScopeRules({
      supabase,
      scope: 'pro',
      rules: nextRules,
    });

    const snapshot = await resolveEffectivePlanLimitSnapshot({ supabase, plan: 'pro' });

    assert.throws(
      () => {
        throwUploadLimitIfNeeded({
          limits: toEffectiveLimitsResult(snapshot),
          fileSizeBytes: 76 * 1024 * 1024,
          correlationId: 'limit-test',
        });
      },
      (error: unknown) =>
        error instanceof EffectiveLimitError &&
        error.payload.limit === 'max_file_size_mb' &&
        error.payload.max === 75 &&
        error.payload.message === 'File exceeds upload size limit (75MB).',
    );
  });

  if (failed > 0) process.exit(1);
}

void main();