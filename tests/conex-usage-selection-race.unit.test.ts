import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const retiredPage = fs.readFileSync(
  path.join(process.cwd(), 'src/app/conex/usage/page.tsx'),
  'utf8',
);
const adminPage = fs.readFileSync(
  path.join(process.cwd(), 'src/app/conex/page.tsx'),
  'utf8',
);
const planLimitsPage = fs.readFileSync(
  path.join(process.cwd(), 'src/app/conex/plan-limits/page.tsx'),
  'utf8',
);

assert.match(retiredPage, /redirect\('\/conex'\)/);
assert.doesNotMatch(adminPage, /TabsContent value="usage"/);
assert.doesNotMatch(adminPage, /TabsContent value="activity"/);
assert.match(planLimitsPage, /Plan Limits/);
assert.match(planLimitsPage, /APPROVED_LIMIT_KEYS/);

console.log('Conex usage monitor retirement and plan-limit access regression passed');
