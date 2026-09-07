import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routePath = path.join(process.cwd(), 'src/app/api/admin/limits/simple-plan-rule/route.ts');
const pagePath = path.join(process.cwd(), 'src/app/conex/usage/page.tsx');
const source = fs.readFileSync(routePath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');

assert.doesNotMatch(
  source,
  /\.upsert\(row, \{ onConflict: 'scope,limit_key' \}\)/,
  'simple plan edits must not unconditionally upsert a stale full rule row',
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
  /revision:\s*z\.string\(\)\.min\(1\)\.max\(2_000\)\.optional\(\)/,
  'the authoritative endpoint must accept the rule revision loaded by the editor',
);

assert.match(
  source,
  /revision:\s*planRuleRevision\(rule, storedRevisions\.get\(key\) \|\| null\)/,
  'GET responses must bind each editable rule to its current stored/effective revision',
);

assert.match(
  source,
  /if \(!input\.revision\) return staleRuleResponse\(requestId\)/,
  'old or incomplete clients must fail closed instead of performing an unversioned write',
);

assert.match(
  source,
  /if \(input\.revision !== currentRevision\) return staleRuleResponse\(requestId\)/,
  'a plan rule changed after the dialog loaded must be rejected before persistence',
);

assert.match(
  source,
  /\.update\(simpleFields\)[\s\S]*?\.eq\('scope', input\.plan\)[\s\S]*?\.eq\('limit_key', input\.metricKey\)[\s\S]*?\.eq\('updated_at', storedUpdatedAt\)[\s\S]*?\.maybeSingle\(\)/,
  'existing plan overrides must use updated_at compare-and-swap at the database write boundary',
);

assert.match(
  source,
  /if \(!saveResult\.data\) return staleRuleResponse\(requestId\)/,
  'a concurrent update that wins after the preflight read must surface as a recoverable 409',
);

assert.match(
  source,
  /\.insert\(\{[\s\S]*?scope:\s*input\.plan,[\s\S]*?limit_key:\s*input\.metricKey,[\s\S]*?\.\.\.simpleFields,[\s\S]*?mode:\s*effective\.mode,[\s\S]*?is_enabled:\s*effective\.isEnabled/,
  'inherited rules must create a plan-scoped override without upserting over a concurrent Advanced edit',
);

assert.match(
  source,
  /saveResult\.error\.code === '23505'\) return staleRuleResponse\(requestId\)/,
  'a concurrent insert of the same plan rule must return a conflict instead of overwriting it',
);

assert.match(
  source,
  /code:\s*'plan_rule_changed'[\s\S]*?409/,
  'stale saves must return an actionable conflict response',
);

const simpleFieldsMatch = source.match(/const simpleFields = \{([\s\S]*?)\n    \};/);
assert.ok(simpleFieldsMatch, 'simple editor persistence fields must remain explicit and reviewable');
assert.doesNotMatch(
  simpleFieldsMatch[1],
  /\bmode\b|\bis_enabled\b/,
  'existing-row saves must not restore Advanced-only mode or enabled state from a stale snapshot',
);

assert.match(
  source,
  /limit:\s*z\.number\(\)\.int\(\)\.min\(0\)\.max\(1_000_000_000\)/,
  'plan-wide caps must require a real numeric JSON value rather than coercing empty, null, or string inputs to zero',
);

assert.doesNotMatch(
  source,
  /limit:\s*z\.coerce\.number\(\)/,
  'plan-wide caps must never use coercive number parsing at the authoritative API boundary',
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

assert.match(
  page,
  /revision:\s*string;/,
  'the client-side plan rule must retain the revision returned by the authoritative GET',
);

assert.match(
  page,
  /revision:\s*editingPlanRule\.revision/,
  'the simple editor must send the exact revision captured when the rule was opened',
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
