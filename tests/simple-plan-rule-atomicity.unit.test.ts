import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.join(process.cwd(), 'src/app/api/admin/limits/simple-plan-rule/route.ts');
const source = fs.readFileSync(routePath, 'utf8');

assert.match(
  source,
  /\.from\('au_plan_limit_rules'\)[\s\S]*?\.upsert\(row, \{ onConflict: 'scope,limit_key' \}\)/,
  'simple plan edits must upsert only the requested scope + metric row',
);

assert.doesNotMatch(
  source,
  /savePlanLimitScopeRules/,
  'simple per-metric edits must not replace/delete a full scope snapshot',
);

assert.doesNotMatch(
  source,
  /APPROVED_LIMIT_KEYS\.reduce\([\s\S]*?storedRulesByScope/,
  'simple per-metric edits must not reconstruct a stale full rule map before persistence',
);

console.log('simple plan rule atomicity regression passed');
