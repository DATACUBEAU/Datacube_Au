"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const admin_user_management_js_1 = require("../src/lib/server/admin-user-management.js");
const TEST_OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
process.env.DATACUBE_OWNER_ADMIN_USER_ID = TEST_OWNER_USER_ID;
const { PLATFORM_OWNER_USER_ID, isProtectedOwnerUserId, } = require('../src/lib/admin/protected-owner.js');
const { isRootConexAdmin } = require('../src/lib/conex-rbac.js');
let failed = 0;
const repoRoot = process.cwd();
function readRepoFile(relativePath) {
    return node_fs_1.default.readFileSync(node_path_1.default.join(repoRoot, relativePath), 'utf8');
}
function run(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error instanceof Error ? error.stack : error);
    }
}
run('protected owner id is authoritative for admin recognition', () => {
    strict_1.default.equal(PLATFORM_OWNER_USER_ID, TEST_OWNER_USER_ID);
    strict_1.default.equal(isProtectedOwnerUserId(PLATFORM_OWNER_USER_ID), true);
    strict_1.default.equal(isRootConexAdmin(PLATFORM_OWNER_USER_ID), true);
    strict_1.default.equal(isProtectedOwnerUserId('22222222-2222-4222-8222-222222222222'), false);
});
run('owner plan switcher uses existing internal plan identifiers', () => {
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAdminAssignablePlan)('free'), 'free');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAdminAssignablePlan)('premium'), 'premium');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAdminAssignablePlan)('pro'), 'pro_monthly');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAdminAssignablePlan)('pro_monthly'), 'pro_monthly');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAdminAssignablePlan)('enterprise'), null);
});
run('owner plan switcher supports every Free Premium Pro transition and reassignment', () => {
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'free', targetPlan: 'premium' }), 'upgrade');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'free', targetPlan: 'pro_monthly' }), 'upgrade');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'premium', targetPlan: 'free' }), 'downgrade');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'pro_monthly', targetPlan: 'free' }), 'downgrade');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'premium', targetPlan: 'pro_monthly' }), 'downgrade');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'pro_monthly', targetPlan: 'premium' }), 'upgrade');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'free', targetPlan: 'free' }), 'reassignment');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'premium', targetPlan: 'premium' }), 'reassignment');
    strict_1.default.equal((0, admin_user_management_js_1.resolveAdminPlanChangeType)({ previousPlan: 'pro_monthly', targetPlan: 'pro_monthly' }), 'reassignment');
});
run('server route only allows protected owner self-targeting through the existing admin RPC path', () => {
    const source = readRepoFile('src/app/api/admin/users/route.ts');
    strict_1.default.match(source, /action: z\.literal\('set_owner_self_plan'\)/);
    strict_1.default.match(source, /targetPlan: z\.enum\(ADMIN_ASSIGNABLE_PLAN_KEYS\)/);
    strict_1.default.match(source, /isProtectedOwnerUserId\(actor\.userId\)/);
    strict_1.default.match(source, /targetUserId !== actor\.userId/);
    strict_1.default.match(source, /owner_self_plan_only/);
    strict_1.default.match(source, /handleSetUserPlan\(/);
    strict_1.default.match(source, /admin_set_user_plan_override/);
    strict_1.default.match(source, /billingRecordsPreserved: true/);
    strict_1.default.match(source, /resolveCanonicalAccountSnapshot\(supabaseAdmin, payload\.userId\)/);
    strict_1.default.match(source, /cacheInvalidation:\s*\{\s*userId: payload\.userId,\s*scope: 'single-user'/s);
    strict_1.default.equal(source.includes(".from('billing_subscriptions').update"), false);
    strict_1.default.equal(source.includes(".from('billing_transactions').update"), false);
});
run('subscription page exposes owner-only controls and refreshes only owner caches after success', () => {
    const source = readRepoFile('src/app/dashboard/settings/subscription/page.tsx');
    strict_1.default.match(source, /accountSnapshot\?\.isProtectedOwner === true/);
    strict_1.default.match(source, /action: 'set_owner_self_plan'/);
    strict_1.default.match(source, /targetUserId: user\.id/);
    strict_1.default.match(source, /OWNER_PLAN_OPTIONS/);
    strict_1.default.match(source, /key: 'free'/);
    strict_1.default.match(source, /key: 'premium'/);
    strict_1.default.match(source, /key: 'pro_monthly'/);
    strict_1.default.match(source, /normalized === 'pro_weekly'/);
    strict_1.default.match(source, /Current billing plan/);
    strict_1.default.match(source, /Effective app plan/);
    strict_1.default.match(source, /Admin override/);
    strict_1.default.match(source, /Switch effective plan from/);
    strict_1.default.match(source, /Existing documents, chats, and generated content will not be deleted/);
    strict_1.default.match(source, /dispatchAccountSnapshotInvalidated\(\{ userId: user\.id, reason: 'owner-plan-switch' \}\)/);
    strict_1.default.match(source, /refreshAccountSnapshot\(\)/);
    strict_1.default.match(source, /refreshUsage\(\)/);
    strict_1.default.match(source, /fetchBillingStatus\(\)/);
});
run('normal users cannot see owner controls from the subscription page source path', () => {
    const source = readRepoFile('src/app/dashboard/settings/subscription/page.tsx');
    strict_1.default.match(source, /const ownerPlanControls = isProtectedOwner \?/);
    strict_1.default.equal(source.includes('NEXT_PUBLIC_DATACUBE_OWNER_ADMIN_USER_ID'), false);
    strict_1.default.equal(source.includes('supabase.from'), false);
});
run('sidebar collapse toggle is fully inside the sidebar header and remains accessible', () => {
    const source = readRepoFile('src/app/dashboard/dashboard-client-layout.tsx');
    strict_1.default.match(source, /DASHBOARD_SIDEBAR_STORAGE_KEY/);
    strict_1.default.match(source, /className="h-9 w-9 shrink-0 rounded-md"/);
    strict_1.default.match(source, /type="button"/);
    strict_1.default.match(source, /aria-label=\{expanded \? 'Collapse dashboard sidebar' : 'Expand dashboard sidebar'\}/);
    strict_1.default.match(source, /aria-expanded=\{expanded\}/);
    strict_1.default.match(source, /group-data-\[collapsible=icon\]:min-h-\[5rem\]/);
    strict_1.default.match(source, /group-data-\[collapsible=icon\]:flex-col/);
    strict_1.default.match(source, /group-data-\[collapsible=icon\]:hidden/);
    strict_1.default.equal(source.includes('supabase.from'), false);
});
if (failed > 0)
    process.exit(1);
