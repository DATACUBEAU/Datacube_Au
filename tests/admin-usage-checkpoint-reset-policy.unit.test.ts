import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260907104500_admin_usage_checkpoint_rule_source.sql',
  'utf8',
);
const canonicalBaselineMigration = readFileSync(
  'supabase/migrations/20260907125000_admin_usage_checkpoint_canonical_baseline.sql',
  'utf8',
);

// Checkpoint source selection must come from the locked canonical effective plan rule,
// not from the shape or duration of the submitted window alone.
assert.match(
  migration,
  /CREATE OR REPLACE FUNCTION public\.admin_usage_tracked_value_for_effective_rule[\s\S]+au_plan_limit_rules[\s\S]+scope IN \(v_plan, 'default'\)[\s\S]+FOR SHARE/i,
);
assert.match(
  migration,
  /concat_ws\('\|', 'plan_limit_rule', 'default', TRIM\(p_metric_key\)\)[\s\S]+concat_ws\('\|', 'plan_limit_rule', v_plan, TRIM\(p_metric_key\)\)/i,
);
assert.match(
  migration,
  /pg_advisory_xact_lock\(hashtextextended\(v_default_lock_key, 0\)\)[\s\S]+pg_advisory_xact_lock\(hashtextextended\(v_plan_lock_key, 0\)\)/i,
);
assert.match(
  migration,
  /SELECT r\.\*[\s\S]+FROM public\.au_plan_limit_rules AS r[\s\S]+FOR SHARE/i,
);
assert.match(
  migration,
  /IF v_rule\.reset_policy = 'never'[\s\S]+FROM public\.usage_totals/i,
);
assert.match(
  migration,
  /IF v_rule\.reset_policy = 'daily'[\s\S]+FROM public\.usage_counters/i,
);
assert.match(
  migration,
  /Hourly, weekly, monthly, and every custom interval[\s\S]+get_usage_metric_window_totals/i,
);

// A custom one-day interval must not be inferred as daily from a 24-hour window.
assert.doesNotMatch(
  migration,
  /p_window_end\s*=\s*p_window_start\s*\+\s*interval '1 day'[\s\S]+FROM public\.usage_counters/i,
);

// The checkpoint must use the effective plan already carried by the authoritative
// server mutation context and route all tracked-source resolution through the rule-aware helper.
assert.match(
  migration,
  /v_effective_plan TEXT := NULLIF\(TRIM\(COALESCE\(p_context ->> 'effective_plan', ''\)\), ''\)/i,
);
assert.match(
  migration,
  /admin_checkpoint_legacy_usage_gap[\s\S]+admin_usage_tracked_value_for_effective_rule\([\s\S]+v_effective_plan[\s\S]+p_window_start[\s\S]+p_window_end/i,
);

// Historical aliases remain accepted inputs for window reconstruction, but once the checkpoint
// materializes a canonical key that key wins canonical resolution. The tracked-value helper must
// therefore compare the baseline against only the already-materialized canonical bucket so the
// checkpoint event writes the full missing remainder, not merely an alias-relative gap.
assert.match(
  canonicalBaselineMigration,
  /CREATE OR REPLACE FUNCTION public\.admin_usage_tracked_value_for_effective_rule/i,
);
assert.match(
  canonicalBaselineMigration,
  /v_aliases TEXT\[\] := public\.admin_usage_metric_aliases\(p_metric_key\)/i,
);
assert.match(
  canonicalBaselineMigration,
  /get_usage_metric_window_totals\([\s\S]+v_aliases[\s\S]+p_window_start[\s\S]+p_window_end/i,
);
assert.match(
  canonicalBaselineMigration,
  /FROM public\.usage_totals[\s\S]+admin_usage_json_metric_value\(v_counters, ARRAY\[v_metric_key\]::TEXT\[\]\)/i,
);
assert.match(
  canonicalBaselineMigration,
  /FROM public\.usage_counters[\s\S]+admin_usage_json_metric_value\(v_counters, ARRAY\[v_metric_key\]::TEXT\[\]\)/i,
);
assert.match(
  canonicalBaselineMigration,
  /get_usage_metric_window_totals\([\s\S]+admin_usage_json_metric_value\(v_window_totals, ARRAY\[v_metric_key\]::TEXT\[\]\)/i,
);
assert.doesNotMatch(
  canonicalBaselineMigration,
  /admin_usage_json_metric_value\((?:v_counters|v_window_totals),\s*v_aliases\)/i,
);

// The canonical-baseline replacement must retain the same locked entitlement/source selection,
// service-role-only helper boundary, and non-destructive rollout behavior.
assert.match(
  canonicalBaselineMigration,
  /au_plan_limit_rules[\s\S]+scope IN \(v_plan, 'default'\)[\s\S]+FOR SHARE/i,
);
assert.match(
  canonicalBaselineMigration,
  /IF v_rule\.reset_policy = 'never'[\s\S]+FROM public\.usage_totals/i,
);
assert.match(
  canonicalBaselineMigration,
  /IF v_rule\.reset_policy = 'daily'[\s\S]+FROM public\.usage_counters/i,
);
assert.match(
  canonicalBaselineMigration,
  /REVOKE ALL ON FUNCTION public\.admin_usage_tracked_value_for_effective_rule[\s\S]+FROM PUBLIC, anon, authenticated/i,
);

// Keep internal helpers unavailable to ordinary PostgREST callers and avoid destructive remediation.
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.admin_usage_tracked_value_for_effective_rule[\s\S]+FROM PUBLIC, anon, authenticated/i,
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.admin_checkpoint_legacy_usage_gap[\s\S]+FROM PUBLIC, anon, authenticated/i,
);
for (const sql of [migration, canonicalBaselineMigration]) {
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(
    sql,
    /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments|au_plan_limit_rules)/i,
  );
}

console.log('admin usage checkpoint reset-policy regressions passed');
