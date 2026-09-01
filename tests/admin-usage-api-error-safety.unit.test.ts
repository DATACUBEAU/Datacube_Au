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
assert.match(usageRoute, /function isUsageIdempotencyConflict[\s\S]*code === '22023'[\s\S]*usage_adjustment_idempotency_conflict/);
assert.match(usageRoute, /if \(isUsageIdempotencyConflict\(error\)\)[\s\S]*code: 'idempotency_conflict'[\s\S]*\}, 409\)/);
assert.match(usageRoute, /This request ID was already used for a different usage action/);
assert.match(simplePlanRoute, /code: 'simple_plan_rules_load_failed'/);
assert.match(simplePlanRoute, /code: 'simple_plan_rule_save_failed'/);

console.log('PASS admin usage APIs classify deterministic conflicts without exposing raw internal failure messages');