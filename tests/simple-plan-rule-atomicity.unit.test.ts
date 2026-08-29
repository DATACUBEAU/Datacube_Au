import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.join(process.cwd(), 'src/app/api/admin/limits/simple-plan-rule/route.ts');
const pagePath = path.join(process.cwd(), 'src/app/conex/usage/page.tsx');
const source = fs.readFileSync(routePath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');

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

assert.match(
  source,
  /isUnlimited:\s*z\.boolean\(\)\.optional\(\)/,
  'simple plan edits must accept an explicit unlimited state',
);

assert.match(
  source,
  /input\.isUnlimited === undefined && effective\.isUnlimited && input\.limit === 0/,
  'legacy zero payloads from an already-unlimited rule must be rejected as ambiguous',
);

assert.match(
  source,
  /code:\s*'explicit_unlimited_state_required'[\s\S]*?409/,
  'ambiguous unlimited-to-zero saves must return a recoverable conflict instead of mutating entitlements',
);

assert.match(
  source,
  /const isUnlimited = input\.isUnlimited \?\? false/,
  'explicit unlimited intent must drive plan-rule persistence',
);

assert.match(
  source,
  /value:\s*isUnlimited \? null : input\.limit/,
  'unlimited rules must persist NULL values to satisfy the canonical database constraint',
);

assert.doesNotMatch(
  source,
  /value:\s*isUnlimited \? 0 : input\.limit/,
  'unlimited rules must never be persisted as numeric zero',
);

assert.match(
  source,
  /is_unlimited:\s*isUnlimited/,
  'simple plan persistence must use the resolved unlimited state instead of forcing finite limits',
);

assert.doesNotMatch(
  source,
  /is_unlimited:\s*false/,
  'simple plan edits must never unconditionally collapse unlimited entitlements to finite limits',
);

assert.match(
  page,
  /const \[planUnlimited, setPlanUnlimited\] = useState\(false\);/,
  'the simple plan editor must keep unlimited as an explicit client state',
);

assert.match(
  page,
  /setPlanUnlimited\(row\.limit === null\);[\s\S]*?setPlanLimit\(row\.limit === null \? '' : String\(row\.limit\)\);/,
  'opening an unlimited rule must preserve Unlimited instead of pre-filling a zero cap',
);

assert.match(
  page,
  /if \(!planUnlimited && trimmedPlanLimit === ''\) \{[\s\S]*?Enter a plan cap/,
  'an empty finite cap must be rejected before numeric coercion can turn it into zero',
);

assert.match(
  page,
  /isUnlimited:\s*planUnlimited/,
  'the client must send explicit unlimited intent to the authoritative plan-rule endpoint',
);

assert.match(
  page,
  /<Select value=\{planUnlimited \? 'unlimited' : 'limited'\}/,
  'admins must be given an explicit Set a cap versus Unlimited choice',
);

console.log('simple plan rule atomicity regression passed');
