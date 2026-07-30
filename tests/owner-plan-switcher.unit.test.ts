import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAdminAssignablePlan,
  resolveAdminPlanChangeType,
} from '../src/lib/server/admin-user-management.js';

const TEST_OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
process.env.DATACUBE_OWNER_ADMIN_USER_ID = TEST_OWNER_USER_ID;

const {
  PLATFORM_OWNER_USER_ID,
  isProtectedOwnerUserId,
} = require('../src/lib/admin/protected-owner.js') as typeof import('../src/lib/admin/protected-owner.js');
const { isRootConexAdmin } = require('../src/lib/conex-rbac.js') as typeof import('../src/lib/conex-rbac.js');

let failed = 0;

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: unknown) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack : error);
  }
}

run('protected owner id is authoritative for admin recognition', () => {
  assert.equal(PLATFORM_OWNER_USER_ID, TEST_OWNER_USER_ID);
  assert.equal(isProtectedOwnerUserId(PLATFORM_OWNER_USER_ID), true);
  assert.equal(isRootConexAdmin(PLATFORM_OWNER_USER_ID), true);
  assert.equal(isProtectedOwnerUserId('22222222-2222-4222-8222-222222222222'), false);
});

run('owner plan switcher uses existing internal plan identifiers', () => {
  assert.equal(normalizeAdminAssignablePlan('free'), 'free');
  assert.equal(normalizeAdminAssignablePlan('premium'), 'premium');
  assert.equal(normalizeAdminAssignablePlan('pro'), 'pro_monthly');
  assert.equal(normalizeAdminAssignablePlan('pro_monthly'), 'pro_monthly');
  assert.equal(normalizeAdminAssignablePlan('enterprise'), null);
});

run('owner plan switcher supports every Free Premium Pro transition and reassignment', () => {
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'free', targetPlan: 'premium' }), 'upgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'free', targetPlan: 'pro_monthly' }), 'upgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'premium', targetPlan: 'free' }), 'downgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'pro_monthly', targetPlan: 'free' }), 'downgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'premium', targetPlan: 'pro_monthly' }), 'downgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'pro_monthly', targetPlan: 'premium' }), 'upgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'free', targetPlan: 'free' }), 'reassignment');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'premium', targetPlan: 'premium' }), 'reassignment');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'pro_monthly', targetPlan: 'pro_monthly' }), 'reassignment');
});

run('server route only allows protected owner self-targeting through the existing admin RPC path', () => {
  const source = readRepoFile('src/app/api/admin/users/route.ts');

  assert.match(source, /action: z\.literal\('set_owner_self_plan'\)/);
  assert.match(source, /targetPlan: z\.enum\(ADMIN_ASSIGNABLE_PLAN_KEYS\)/);
  assert.match(source, /isProtectedOwnerUserId\(actor\.userId\)/);
  assert.match(source, /targetUserId !== actor\.userId/);
  assert.match(source, /owner_self_plan_only/);
  assert.match(source, /handleSetUserPlan\(/);
  assert.match(source, /admin_set_user_plan_override/);
  assert.match(source, /billingRecordsPreserved: true/);
  assert.match(source, /resolveCanonicalAccountSnapshot\(supabaseAdmin, payload\.userId\)/);
  assert.match(source, /cacheInvalidation:\s*\{\s*userId: payload\.userId,\s*scope: 'single-user'/s);
  assert.equal(source.includes(".from('billing_subscriptions').update"), false);
  assert.equal(source.includes(".from('billing_transactions').update"), false);
});

run('subscription page exposes owner-only controls and refreshes only owner caches after success', () => {
  const source = readRepoFile('src/app/dashboard/settings/subscription/page.tsx');

  assert.match(source, /accountSnapshot\?\.isProtectedOwner === true/);
  assert.match(source, /action: 'set_owner_self_plan'/);
  assert.match(source, /targetUserId: user\.id/);
  assert.match(source, /OWNER_PLAN_OPTIONS/);
  assert.match(source, /key: 'free'/);
  assert.match(source, /key: 'premium'/);
  assert.match(source, /key: 'pro_monthly'/);
  assert.match(source, /normalized === 'pro_weekly'/);
  assert.match(source, /Current billing plan/);
  assert.match(source, /Effective app plan/);
  assert.match(source, /Admin override/);
  assert.match(source, /Switch effective plan from/);
  assert.match(source, /Existing documents, chats, and generated content will not be deleted/);
  assert.match(source, /dispatchAccountSnapshotInvalidated\(\{ userId: user\.id, reason: 'owner-plan-switch' \}\)/);
  assert.match(source, /refreshAccountSnapshot\(\)/);
  assert.match(source, /refreshUsage\(\)/);
  assert.match(source, /fetchBillingStatus\(\)/);
});

run('normal users cannot see owner controls from the subscription page source path', () => {
  const source = readRepoFile('src/app/dashboard/settings/subscription/page.tsx');

  assert.match(source, /const ownerPlanControls = isProtectedOwner \?/);
  assert.equal(source.includes('NEXT_PUBLIC_DATACUBE_OWNER_ADMIN_USER_ID'), false);
  assert.equal(source.includes('supabase.from'), false);
});

run('sidebar collapse toggle is fully inside the sidebar header and remains accessible', () => {
  const source = readRepoFile('src/app/dashboard/dashboard-client-layout.tsx');

  assert.match(source, /DASHBOARD_SIDEBAR_STORAGE_KEY/);
  assert.match(source, /className="h-9 w-9 shrink-0 rounded-md"/);
  assert.match(source, /type="button"/);
  assert.match(source, /aria-label=\{expanded \? 'Collapse dashboard sidebar' : 'Expand dashboard sidebar'\}/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /group-data-\[collapsible=icon\]:min-h-\[5rem\]/);
  assert.match(source, /group-data-\[collapsible=icon\]:flex-col/);
  assert.match(source, /group-data-\[collapsible=icon\]:hidden/);
  assert.equal(source.includes('supabase.from'), false);
});

if (failed > 0) process.exit(1);
