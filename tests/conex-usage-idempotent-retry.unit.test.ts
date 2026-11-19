import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const retiredPage = fs.readFileSync(
  path.join(process.cwd(), 'src/app/conex/usage/page.tsx'),
  'utf8',
);
const usageRoute = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/admin/limits/user-usage/route.ts'),
  'utf8',
);
const planRuleRoute = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/admin/limits/simple-plan-rule/route.ts'),
  'utf8',
);

assert.match(retiredPage, /redirect\('\/conex'\)/);
assert.match(usageRoute, /requireConexAdmin/);
assert.match(usageRoute, /scopedUsageAdjustmentRequestId/);
assert.match(usageRoute, /usage_adjustment_idempotency_conflict/);
assert.match(planRuleRoute, /requireConexAdmin/);
assert.match(planRuleRoute, /planRuleRevision/);
assert.match(planRuleRoute, /staleRuleResponse/);

console.log('Retired usage UI and protected admin mutation idempotency regressions passed');
