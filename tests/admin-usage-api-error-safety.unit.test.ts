import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const usageRoute = readFileSync('src/app/api/admin/limits/user-usage/route.ts', 'utf8');
const simplePlanRoute = readFileSync('src/app/api/admin/limits/simple-plan-rule/route.ts', 'utf8');

for (const route of [usageRoute, simplePlanRoute]) {
  assert.match(route, /use the request ID if you need support/);
  assert.doesNotMatch(route, /String\(error\?\.message/);
  assert.doesNotMatch(route, /message:\s*error\?\.message/);
}

assert.match(usageRoute, /code: 'user_usage_load_failed'/);
assert.match(usageRoute, /code: 'user_usage_update_failed'/);
assert.match(usageRoute, /amount:\s*z\.number\(\)\.finite\(\)\.int\(\)\.min\(0\)/);
assert.doesNotMatch(usageRoute, /amount:\s*z\.coerce\.number\(\)/);
assert.match(
  usageRoute,
  /\(body\.action === 'increase' \|\| body\.action === 'decrease' \|\| body\.action === 'set'\) && body\.amount === undefined/,
  'relative/set actions must still require an explicit numeric amount after strict JSON number validation',
);
assert.match(usageRoute, /function isUsageIdempotencyConflict[\s\S]*code === '22023'[\s\S]*usage_adjustment_idempotency_conflict/);
assert.match(usageRoute, /if \(isUsageIdempotencyConflict\(error\)\)[\s\S]*code: 'idempotency_conflict'[\s\S]*\}, 409\)/);
assert.match(usageRoute, /This request ID was already used for a different usage action/);

assert.match(
  usageRoute,
  /async function loadCommittedUsageSnapshot[\s\S]*resolveCanonicalEffectiveLimits[\s\S]*refreshRequired: false[\s\S]*catch[\s\S]*refreshRequired: true[\s\S]*usage: null/,
  'a failed read after a committed usage mutation must degrade to reload-required success instead of throwing into mutation failure handling',
);
assert.match(
  usageRoute,
  /admin_adjust_usage_reset_all_versioned[\s\S]*if \(error\) throw error;[\s\S]*loadCommittedUsageSnapshot[\s\S]*refreshRequired: snapshot\.refreshRequired/,
  'reset_all must cross the authoritative write boundary before optional snapshot refresh and expose refreshRequired on read failure',
);
assert.match(
  usageRoute,
  /const result = await applyAdjustment[\s\S]*if \(!result\.ok\)[\s\S]*loadCommittedUsageSnapshot[\s\S]*refreshRequired: snapshot\.refreshRequired/,
  'single usage adjustments must report committed success even when the post-write snapshot cannot be refreshed',
);
assert.doesNotMatch(
  usageRoute,
  /const refreshed = await resolveCanonicalEffectiveLimits\(\{ supabase: adminResult\.supabase, userId: body\.userId \}\);\s*return json\(\{\s*ok: true,[\s\S]*action: body\.action/,
  'post-commit refreshes must not remain unguarded inside the outer mutation try/catch',
);

assert.match(simplePlanRoute, /code: 'simple_plan_rules_load_failed'/);
assert.match(simplePlanRoute, /code: 'simple_plan_rule_save_failed'/);

console.log('PASS admin usage APIs reject coerced amounts, classify deterministic conflicts, and preserve committed-write success without exposing raw internal failure messages');
