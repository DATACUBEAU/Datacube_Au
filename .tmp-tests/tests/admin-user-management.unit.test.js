"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const admin_user_management_js_1 = require("../src/lib/server/admin-user-management.js");
let failed = 0;
function run(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
const now = new Date('2026-02-20T12:00:00.000Z').toISOString();
const seedUsers = [
    {
        user_id: '11111111-1111-4111-8111-111111111111',
        email: 'alice@example.com',
        full_name: 'Alice Admin',
        avatar_url: null,
        provider: 'supabase',
        created_at: now,
        last_sign_in_at: now,
        last_active_at: now,
        account_status: 'active',
        role: 'admin',
        tier: 'admin',
        permissions: ['users:manage'],
        is_suspended: false,
        is_authorized: true,
    },
    {
        user_id: '22222222-2222-4222-8222-222222222222',
        email: 'bob@example.com',
        full_name: 'Bob Free',
        avatar_url: null,
        provider: 'supabase',
        created_at: '2026-02-19T12:00:00.000Z',
        last_sign_in_at: '2026-02-19T12:00:00.000Z',
        last_active_at: '2026-02-19T12:00:00.000Z',
        account_status: 'inactive',
        role: 'free',
        tier: 'free',
        permissions: ['documents:read'],
        is_suspended: false,
        is_authorized: false,
    },
];
run('status and role normalizers are strict', () => {
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAccountStatus)('active'), 'active');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAccountStatus)('suspended'), 'suspended');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAccountStatus)('weird', 'inactive'), 'inactive');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeUserRole)('admin'), 'admin');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeUserRole)('pro'), 'pro');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeUserRole)('unknown', 'user'), 'user');
});
run('permission normalization removes invalid chars and duplicates', () => {
    const normalized = (0, admin_user_management_js_1.normalizePermissions)([' users:manage ', 'USERS:MANAGE', 'bad value!@#', '', null]);
    strict_1.default.deepEqual(normalized, ['users:manage', 'badvalue']);
});
run('role to tier mapping handles pro and invalid roles safely', () => {
    strict_1.default.equal((0, admin_user_management_js_1.roleToTier)('admin'), 'admin');
    strict_1.default.equal((0, admin_user_management_js_1.roleToTier)('pro'), 'monthly');
    strict_1.default.equal((0, admin_user_management_js_1.roleToTier)('user'), null);
});
run('metadata patch merges status role and permissions correctly', () => {
    const patch = (0, admin_user_management_js_1.buildAppMetadataPatch)({ role: 'user', account_status: 'active', permissions: ['documents:read'] }, { status: 'inactive', role: 'admin', permissions: ['users:manage', 'users:manage'] });
    strict_1.default.equal(patch.account_status, 'inactive');
    strict_1.default.equal(patch.role, 'admin');
    strict_1.default.deepEqual(patch.permissions, ['users:manage']);
});
run('filter users by search/status/role and sort', () => {
    const filtered = (0, admin_user_management_js_1.filterManagedUsers)(seedUsers, {
        q: 'alice',
        status: 'active',
        role: 'admin',
        sortBy: 'email',
        sortDir: 'asc',
    });
    strict_1.default.equal(filtered.length, 1);
    strict_1.default.equal(filtered[0].email, 'alice@example.com');
});
run('bulk user id validation rejects invalid payloads', () => {
    const valid = (0, admin_user_management_js_1.validateBulkUserIds)([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
    ]);
    strict_1.default.deepEqual(valid, [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
    ]);
    strict_1.default.throws(() => (0, admin_user_management_js_1.validateBulkUserIds)('bad'), /Expected userIds array/);
    strict_1.default.throws(() => (0, admin_user_management_js_1.validateBulkUserIds)(['not-a-uuid']), /Invalid user ID/);
});
if (failed > 0)
    process.exit(1);
