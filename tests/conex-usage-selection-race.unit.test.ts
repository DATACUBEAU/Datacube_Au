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
  /<Select value=\{selectedUserId\} onValueChange=\{selectUser\}/,
  'user selection must pass through the invalidating selection handler',
);

console.log('Conex usage selection race regression passed');
