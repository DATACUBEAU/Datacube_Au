import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/admin/limits/user-usage/route.ts', 'utf8');
const liveRuleMigration = readFileSync(
  'supabase/migrations/20260907055000_admin_usage_plan_rule_window_guard.sql',
  'utf8',
);

// The authoritative server route must compare the effective plan as well as each
// metric's adjustability before submitting a correction prepared from an older snapshot.
assert.match(
  route,
  /function sameAdjustmentEligibility[\s\S]+left\.plan !== right\.plan[\s\S]+leftRule\.mode === rightRule\.mode[\s\S]+leftRule\.isEnabled === rightRule\.isEnabled/,
);

// A reset-all operation is especially sensitive to plan/rule churn: compare all
// approved metrics so neither a newly enabled nor newly disabled usage metric can
// slip through a stale batch assembled from the first snapshot.
assert.match(
  route,
  /if \(!sameAdjustmentEligibility\(initialEffective, mutationEffective, APPROVED_LIMIT_KEYS\)\)[\s\S]+usage_adjustment_conflict/,
);

// Single-metric corrections must apply the same plan/eligibility guard to the
// selected metric and retain the existing exact reset-window comparison.
assert.match(
  route,
  /sameAdjustmentEligibility\(initialEffective, mutationEffective, \[body\.metricKey\]\)[\s\S]+sameResetWindow\(initialReset, mutationEffective\.usage\.by_limit\[body\.metricKey\]\.reset\)/,
);

// The stale-entitlement guard must execute before either mutation path is delegated.
const resetAllGuardIndex = route.indexOf('sameAdjustmentEligibility(initialEffective, mutationEffective, APPROVED_LIMIT_KEYS)');
const resetAllRpcIndex = route.indexOf("rpc('admin_adjust_usage_reset_all_versioned'");
assert.ok(resetAllGuardIndex >= 0 && resetAllRpcIndex > resetAllGuardIndex);

const singleGuardIndex = route.indexOf('sameAdjustmentEligibility(initialEffective, mutationEffective, [body.metricKey])');
const applyAdjustmentCallIndex = route.indexOf('const result = await applyAdjustment({');
assert.ok(singleGuardIndex >= 0 && applyAdjustmentCallIndex > singleGuardIndex);

assert.match(route, /code: 'usage_changed'/);
assert.match(route, /Refresh and try again/);

// Application revalidation is not the final trust boundary. Every new ledger row
// must resolve and lock the canonical plan-specific/default rule inside PostgreSQL,
// where plan-rule writes share the same advisory-key namespace.
assert.match(
  liveRuleMigration,
  /CREATE TRIGGER trg_au_plan_limit_rules_serialize_write[\s\S]+BEFORE INSERT OR UPDATE OR DELETE[\s\S]+lock_plan_limit_rule_write\(\)/i,
);
assert.match(
  liveRuleMigration,
  /concat_ws\('\|', 'plan_limit_rule', 'default', NEW\.metric_key\)[\s\S]+concat_ws\('\|', 'plan_limit_rule', v_plan, NEW\.metric_key\)[\s\S]+pg_advisory_xact_lock/i,
);
assert.match(
  liveRuleMigration,
  /FROM public\.au_plan_limit_rules AS r[\s\S]+r\.scope IN \(v_plan, 'default'\)[\s\S]+ORDER BY CASE WHEN r\.scope = v_plan THEN 0 ELSE 1 END[\s\S]+FOR SHARE/i,
);

// New corrections are valid only for an enabled usage-mode rule and the exact
// UTC window implied by that locked rule. Lifetime rules remain epoch/null; all
// finite and custom policies are derived at the database boundary.
assert.match(liveRuleMigration, /v_rule\.mode <> 'usage' OR NOT v_rule\.is_enabled/i);
assert.match(liveRuleMigration, /v_rule\.reset_policy = 'never'[\s\S]+v_expected_start := v_epoch[\s\S]+v_expected_end := NULL/i);
assert.match(liveRuleMigration, /reset_policy = 'hourly'[\s\S]+date_trunc\('hour'/i);
assert.match(liveRuleMigration, /reset_policy = 'daily'[\s\S]+date_trunc\('day'/i);
assert.match(liveRuleMigration, /reset_policy = 'weekly'[\s\S]+date_trunc\('week'/i);
assert.match(liveRuleMigration, /reset_policy = 'monthly'[\s\S]+date_trunc\('month'/i);
assert.match(liveRuleMigration, /reset_policy = 'custom'[\s\S]+reset_interval_unit = 'hour'[\s\S]+reset_interval_unit = 'day'[\s\S]+reset_interval_unit = 'week'[\s\S]+reset_interval_unit = 'month'/i);
assert.match(
  liveRuleMigration,
  /NEW\.window_start IS DISTINCT FROM v_expected_start[\s\S]+NEW\.window_end IS DISTINCT FROM v_expected_end[\s\S]+usage_adjustment_rule_window_conflict/i,
);

// The guard is INSERT-only on the append-only ledger. Completed idempotent
// retries return their stored receipt without another insert, so later rule
// edits cannot make an already completed request unrecoverable.
assert.match(
  liveRuleMigration,
  /CREATE TRIGGER trg_au_usage_admin_adjustments_live_plan_rule[\s\S]+BEFORE INSERT[\s\S]+ON public\.au_usage_admin_adjustments/i,
);
assert.doesNotMatch(liveRuleMigration, /\bUPDATE\s+public\.au_usage_admin_adjustments\b/i);
assert.doesNotMatch(liveRuleMigration, /\bDELETE\s+FROM\s+public\.au_usage_admin_adjustments\b/i);
assert.doesNotMatch(liveRuleMigration, /\bTRUNCATE\b/i);

console.log('admin usage entitlement-race regressions passed');