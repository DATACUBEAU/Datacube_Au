import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pagePath = path.join(process.cwd(), 'src/app/conex/usage/page.tsx');
const source = fs.readFileSync(pagePath, 'utf8');

assert.match(
  source,
  /const selectedUserIdRef = useRef\(''\);[\s\S]*?const userListRequestVersionRef = useRef\(0\);[\s\S]*?const usageRequestVersionRef = useRef\(0\);[\s\S]*?const planRuleRequestVersionRef = useRef\(0\);/,
  'Conex usage must keep selected-user identity plus user-list, usage, and plan-rule generation guards',
);

assert.match(
  source,
  /const loadUsers = useCallback\(async \(q = ''\) => \{[\s\S]*?const requestVersion = \+\+userListRequestVersionRef\.current;[\s\S]*?requestVersion !== userListRequestVersionRef\.current[\s\S]*?setUsers\(next\);[\s\S]*?selectUser\(nextUserId\);/,
  'user-list responses must be discarded unless they are still the newest search before updating results or selection',
);

assert.match(
  source,
  /catch \(error: any\) \{[\s\S]*?requestVersion !== userListRequestVersionRef\.current[\s\S]*?Users could not load[\s\S]*?finally \{[\s\S]*?requestVersion === userListRequestVersionRef\.current[\s\S]*?setLoadingUsers\(false\);/,
  'stale user-list requests must not surface errors or clear the loading state owned by a newer search',
);

assert.match(
  source,
  /const selectUser = useCallback\([\s\S]*?selectedUserIdRef\.current = userId;[\s\S]*?usageRequestVersionRef\.current \+= 1;[\s\S]*?planRuleRequestVersionRef\.current \+= 1;[\s\S]*?setUsage\(null\);/,
  'switching users must invalidate both usage and plan-rule requests before changing displayed identity',
);

assert.match(
  source,
  /const requestVersion = \+\+usageRequestVersionRef\.current;[\s\S]*?requestVersion !== usageRequestVersionRef\.current[\s\S]*?selectedUserIdRef\.current !== userId[\s\S]*?payload\.userId !== userId[\s\S]*?setUsage\(payload\);/,
  'usage responses must be discarded unless request generation, selected user, and payload user all still match',
);

assert.match(
  source,
  /const loadPlanRules = useCallback\(async \(plan: string, userId: string\) => \{[\s\S]*?const requestVersion = \+\+planRuleRequestVersionRef\.current;[\s\S]*?requestVersion !== planRuleRequestVersionRef\.current[\s\S]*?selectedUserIdRef\.current !== userId[\s\S]*?payload\.plan !== plan[\s\S]*?setPlanRules\(/,
  'plan-rule responses must be discarded unless generation, selected user, and returned plan still match',
);

assert.match(
  source,
  /setUsage\(\(current\) => current\?\.userId === targetUserId \?/,
  'mutation responses must not overwrite usage state for a newly selected user',
);

assert.match(
  source,
  /selectedUserIdRef\.current !== targetUserId \|\| payload\.plan !== targetPlan[\s\S]*?setPlanRules\(/,
  'plan-rule mutation responses must not overwrite state after switching users or plans',
);

assert.match(
  source,
  /const trimmedAmount = amount\.trim\(\);[\s\S]*?action !== 'reset' && trimmedAmount === ''[\s\S]*?Enter an amount[\s\S]*?return;[\s\S]*?const numericAmount = action === 'reset' \? 0 : Number\(trimmedAmount\);/,
  'blank adjustment input must be rejected before numeric coercion can turn an empty value into zero',
);

assert.doesNotMatch(
  source,
  /const numericAmount = Number\(amount\);/,
  'raw adjustment input must not be coerced directly because Number(\'\') is zero',
);

assert.match(
  source,
  /const percent = row\.limit === null[\s\S]*?row\.limit === 0[\s\S]*?\? 100[\s\S]*?Math\.min\(100, Math\.round\(\(row\.used \/ row\.limit\) \* 100\)\);/,
  'finite zero-cap usage must render as exhausted rather than as zero percent consumed',
);

assert.match(
  source,
  /const blocked = row\.limit !== null && row\.used >= row\.limit;/,
  'blocked state must use the authoritative used-versus-limit comparison instead of rounded percentage',
);

assert.match(
  source,
  /const disabledUsageRows = usageRows\.filter\(\(row\) => row\.mode === 'usage' && !row\.adjustable\);[\s\S]*?const capacityRows = usageRows\.filter\(\(row\) => row\.mode !== 'usage'\);/,
  'disabled usage rules must remain distinct from non-usage live-capacity rules',
);

assert.match(
  source,
  /Unavailable usage[\s\S]*?disabled for this plan and cannot be adjusted here[\s\S]*?Advanced Plan Limits/,
  'disabled usage allowances must be explained as unavailable with a recovery path instead of being mislabeled as capacity',
);

assert.match(
  source,
  /<Select value=\{selectedUserId\} onValueChange=\{selectUser\}/,
  'user selection must pass through the invalidating selection handler',
);

console.log('Conex usage selection, input, and presentation regressions passed');