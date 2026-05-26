"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const plan_limit_model_js_1 = require("../src/lib/limits/plan-limit-model.js");
const au_limits_js_1 = require("../src/lib/server/au-limits.js");
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
function toRuleRow(scope, rule) {
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
function applyFilters(rows, filters) {
    return rows.filter((row) => {
        for (const filter of filters) {
            const value = row[filter.column];
            if (filter.kind === 'eq' && value !== filter.value)
                return false;
            if (filter.kind === 'in' && !filter.values.includes(value))
                return false;
        }
        return true;
    });
}
class PlanLimitQueryBuilder {
    constructor(rows) {
        this.rows = rows;
        this.action = 'select';
        this.filters = [];
        this.selectOptions = null;
    }
    select(_columns, options) {
        this.action = 'select';
        this.selectOptions = options || null;
        return this;
    }
    delete() {
        this.action = 'delete';
        this.selectOptions = null;
        return this;
    }
    async upsert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const row of rows) {
            const index = this.rows.findIndex((entry) => entry.scope === row.scope && entry.limit_key === row.limit_key);
            if (index >= 0) {
                this.rows[index] = { ...this.rows[index], ...row };
            }
            else {
                this.rows.push({ ...row });
            }
        }
        return { data: null, error: null };
    }
    eq(column, value) {
        this.filters.push({ kind: 'eq', column, value });
        return this;
    }
    in(column, values) {
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
    then(resolve, reject) {
        try {
            const filtered = applyFilters(this.rows, this.filters);
            if (this.action === 'delete') {
                for (const row of filtered) {
                    const index = this.rows.indexOf(row);
                    if (index >= 0)
                        this.rows.splice(index, 1);
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
        }
        catch (error) {
            if (reject) {
                reject(error);
                return;
            }
            throw error;
        }
    }
}
class FakePlanLimitSupabase {
    constructor(seedRows) {
        this.rows = seedRows.map((row) => ({ ...row }));
    }
    from(table) {
        strict_1.default.equal(table, 'au_plan_limit_rules');
        return new PlanLimitQueryBuilder(this.rows);
    }
}
function createSupabaseStub() {
    const defaultRules = (0, plan_limit_model_js_1.buildDefaultRuleSet)();
    const rows = [];
    for (const rule of Object.values(defaultRules)) {
        rows.push(toRuleRow('default', rule));
    }
    for (const plan of plan_limit_model_js_1.DEFAULT_PLAN_ORDER) {
        const seedRules = (0, plan_limit_model_js_1.buildSeedPlanRuleSet)(plan);
        for (const key of plan_limit_model_js_1.APPROVED_LIMIT_KEYS) {
            rows.push(toRuleRow(plan, seedRules[key]));
        }
    }
    const supabase = new FakePlanLimitSupabase(rows);
    return supabase;
}
function createRuleMap(plan, state) {
    const seeded = (0, plan_limit_model_js_1.buildSeedPlanRuleSet)(plan);
    return plan_limit_model_js_1.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        acc[key] = state.storedRulesByScope[plan][key] || seeded[key];
        return acc;
    }, {});
}
function toEffectiveLimitsResult(snapshot) {
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
        const promoPlan = (0, au_limits_js_1.resolveEffectivePlanFromInputs)({
            profileTier: 'free',
            mirroredPlan: 'free',
            mirroredSource: 'none',
            mirroredExpiresAt: null,
            entitlementPlan: 'promo_pro',
            entitlementSource: 'promo',
            entitlementEndsAt: '2026-04-01T23:00:00.000Z',
        });
        strict_1.default.equal(promoPlan.plan, 'free');
        strict_1.default.equal(promoPlan.entitlementSource, 'none');
        const promoFallbackPlan = (0, au_limits_js_1.resolveEffectivePlanFromInputs)({
            profileTier: null,
            mirroredPlan: null,
            mirroredSource: null,
            mirroredExpiresAt: null,
            entitlementPlan: 'promo_pro',
            entitlementSource: 'promo',
            entitlementEndsAt: '2026-04-01T23:00:00.000Z',
        });
        strict_1.default.equal(promoFallbackPlan.plan, 'free');
        strict_1.default.equal(promoFallbackPlan.source, 'billing');
        strict_1.default.equal(promoFallbackPlan.entitlementSource, 'promo');
        const paidPlan = (0, au_limits_js_1.resolveEffectivePlanFromInputs)({
            profileTier: 'free',
            mirroredPlan: null,
            mirroredSource: 'none',
            mirroredExpiresAt: null,
            entitlementPlan: 'pro',
            entitlementSource: 'paid',
            entitlementEndsAt: '2026-04-18T00:00:00.000Z',
        });
        strict_1.default.equal(paidPlan.plan, 'pro');
        strict_1.default.equal(paidPlan.source, 'billing');
        strict_1.default.equal(paidPlan.entitlementSource, 'paid');
    });
    await run('saving plan limits updates the canonical effective snapshot used by preview and user reads', async () => {
        const supabase = createSupabaseStub();
        const before = await (0, au_limits_js_1.resolveEffectivePlanLimitSnapshot)({ supabase, plan: 'pro' });
        strict_1.default.equal(before.limits.max_chats_total, 30000);
        strict_1.default.equal(before.limits.max_file_size_mb, 50);
        const state = await (0, au_limits_js_1.loadAdminPlanLimitState)(supabase);
        const nextRules = createRuleMap('pro', state);
        nextRules.max_chats_total = {
            ...nextRules.max_chats_total,
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
            ...nextRules.max_file_size_mb,
            value: 75,
            mode: 'per_request',
            resetPolicy: 'never',
            resetIntervalValue: null,
            resetIntervalUnit: null,
            isEnabled: true,
            isUnlimited: false,
            updatedAt: '2026-03-18T12:30:00.000Z',
        };
        await (0, au_limits_js_1.savePlanLimitScopeRules)({
            supabase,
            scope: 'pro',
            rules: nextRules,
        });
        const reloaded = await (0, au_limits_js_1.loadAdminPlanLimitState)(supabase);
        const snapshot = await (0, au_limits_js_1.resolveEffectivePlanLimitSnapshot)({ supabase, plan: 'pro' });
        const chatsRule = (0, au_limits_js_1.serializeEffectivePlanLimitRule)(snapshot.limitRules.max_chats_total);
        const fileRule = (0, au_limits_js_1.serializeEffectivePlanLimitRule)(snapshot.limitRules.max_file_size_mb);
        strict_1.default.equal(reloaded.effectiveRulesByPlan.pro.max_chats_total.value, 42000);
        strict_1.default.equal(reloaded.effectiveRulesByPlan.pro.max_file_size_mb.value, 75);
        strict_1.default.equal(snapshot.limits.max_chats_total, 42000);
        strict_1.default.equal(snapshot.limits.max_file_size_mb, 75);
        strict_1.default.equal(chatsRule.presentation?.summary, '42,000 messages / Usage-based / Weekly');
        strict_1.default.equal(fileRule.presentation?.summary, '75 MB / Per request / No reset');
        strict_1.default.equal(fileRule.presentation?.reset_description, 'Checked on every request. It does not use a scheduled reset window.');
    });
    await run('canonical effective limits resolver powers admin preview plan overrides from the same stored rules', async () => {
        const supabase = createSupabaseStub();
        const state = await (0, au_limits_js_1.loadAdminPlanLimitState)(supabase);
        const nextRules = createRuleMap('pro', state);
        nextRules.max_chats_total = {
            ...nextRules.max_chats_total,
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
            ...nextRules.max_file_size_mb,
            value: 75,
            mode: 'per_request',
            resetPolicy: 'never',
            resetIntervalValue: null,
            resetIntervalUnit: null,
            isEnabled: true,
            isUnlimited: false,
            updatedAt: '2026-03-18T12:40:00.000Z',
        };
        await (0, au_limits_js_1.savePlanLimitScopeRules)({
            supabase,
            scope: 'pro',
            rules: nextRules,
        });
        const resolved = await (0, au_limits_js_1.resolveCanonicalEffectiveLimits)({
            supabase,
            planOverride: 'pro',
        });
        strict_1.default.equal(resolved.plan, 'pro');
        strict_1.default.equal(resolved.effectivePlan.plan, 'pro');
        strict_1.default.equal(resolved.effectivePlan.source, 'default');
        strict_1.default.equal(resolved.limits.max_chats_total, 42000);
        strict_1.default.equal(resolved.limits.max_file_size_mb, 75);
        strict_1.default.equal(resolved.limitRules.max_chats_total.resetPolicy, 'weekly');
        strict_1.default.equal(resolved.usage.by_limit.max_chats_total.used, 0);
        strict_1.default.equal(resolved.usage.by_limit.max_file_size_mb.limit, 75);
    });
    await run('upload enforcement reads the same persisted canonical file-size rule', async () => {
        const supabase = createSupabaseStub();
        const state = await (0, au_limits_js_1.loadAdminPlanLimitState)(supabase);
        const nextRules = createRuleMap('pro', state);
        nextRules.max_file_size_mb = {
            ...nextRules.max_file_size_mb,
            value: 75,
            mode: 'per_request',
            resetPolicy: 'never',
            resetIntervalValue: null,
            resetIntervalUnit: null,
            isEnabled: true,
            isUnlimited: false,
            updatedAt: '2026-03-18T12:35:00.000Z',
        };
        await (0, au_limits_js_1.savePlanLimitScopeRules)({
            supabase,
            scope: 'pro',
            rules: nextRules,
        });
        const snapshot = await (0, au_limits_js_1.resolveEffectivePlanLimitSnapshot)({ supabase, plan: 'pro' });
        strict_1.default.throws(() => {
            (0, au_limits_js_1.throwUploadLimitIfNeeded)({
                limits: toEffectiveLimitsResult(snapshot),
                fileSizeBytes: 76 * 1024 * 1024,
                correlationId: 'limit-test',
            });
        }, (error) => error instanceof au_limits_js_1.EffectiveLimitError &&
            error.payload.limit === 'max_file_size_mb' &&
            error.payload.max === 75 &&
            error.payload.message === 'File exceeds upload size limit (75MB).');
    });
    if (failed > 0)
        process.exit(1);
}
void main();
