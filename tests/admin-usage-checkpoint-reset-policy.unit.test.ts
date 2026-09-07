import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260907104500_admin_usage_checkpoint_rule_source.sql',
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
  /pg_advisory_xact_lock[\s\S]+plan_limit_rule[\s\S]+SELECT r\.\*[\s\S]+FOR SHARE/i,
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

// Keep internal helpers unavailable to ordinary PostgREST callers and avoid destructive remediation.
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.admin_usage_tracked_value_for_effective_rule[\s\S]+FROM PUBLIC, anon, authenticated/i,
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.admin_checkpoint_legacy_usage_gap[\s\S]+FROM PUBLIC, anon, authenticated/i,
);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments|au_plan_limit_rules)/i,
);

console.log('admin usage checkpoint reset-policy regressions passed');
