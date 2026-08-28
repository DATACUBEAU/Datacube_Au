import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pagePath = path.join(process.cwd(), 'src/app/conex/usage/page.tsx');
const source = fs.readFileSync(pagePath, 'utf8');

assert.match(
  source,
  /const selectedUserIdRef = useRef\(''\);[\s\S]*?const usageRequestVersionRef = useRef\(0\);/,
  'Conex usage must keep an immediate selected-user identity and request generation guard',
);

assert.match(
  source,
  /const selectUser = useCallback\([\s\S]*?selectedUserIdRef\.current = userId;[\s\S]*?usageRequestVersionRef\.current \+= 1;[\s\S]*?setUsage\(null\);/,
  'switching users must invalidate in-flight usage requests before changing displayed identity',
);

assert.match(
  source,
  /const requestVersion = \+\+usageRequestVersionRef\.current;[\s\S]*?requestVersion !== usageRequestVersionRef\.current[\s\S]*?selectedUserIdRef\.current !== userId[\s\S]*?payload\.userId !== userId[\s\S]*?setUsage\(payload\);/,
  'usage responses must be discarded unless request generation, selected user, and payload user all still match',
);

assert.match(
  source,
  /setUsage\(\(current\) => current\?\.userId === targetUserId \?/,
  'mutation responses must not overwrite usage state for a newly selected user',
);

assert.match(
  source,
  /<Select value=\{selectedUserId\} onValueChange=\{selectUser\}/,
  'user selection must pass through the invalidating selection handler',
);

console.log('Conex usage selection race regression passed');
