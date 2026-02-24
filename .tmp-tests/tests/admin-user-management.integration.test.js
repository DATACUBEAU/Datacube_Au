"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const conex_rbac_js_1 = require("../src/lib/conex-rbac.js");
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
run('permission-level checks deny free users and allow admin tier for Conex management', () => {
    const freeAccess = (0, conex_rbac_js_1.hasConexAccess)({
        userId: '33333333-3333-4333-8333-333333333333',
        email: 'free@example.com',
        tier: 'free',
    });
    const adminAccess = (0, conex_rbac_js_1.hasConexAccess)({
        userId: '44444444-4444-4444-8444-444444444444',
        email: 'admin@example.com',
        tier: 'admin',
    });
    strict_1.default.equal(freeAccess, false);
    strict_1.default.equal(adminAccess, true);
});
run('bulk metadata patch stays bounded to approved role/status/permission values', () => {
    const patch = (0, admin_user_management_js_1.buildAppMetadataPatch)({ role: 'free', account_status: 'active', permissions: ['documents:read'] }, {
        role: (0, admin_user_management_js_1.normalizeUserRole)('weekly'),
        status: (0, admin_user_management_js_1.normalizeAccountStatus)('inactive'),
        permissions: (0, admin_user_management_js_1.normalizePermissions)(['users:manage', ' users:manage ', 'invalid permission!']),
    });
    strict_1.default.equal(patch.role, 'weekly');
    strict_1.default.equal(patch.account_status, 'inactive');
    strict_1.default.deepEqual(patch.permissions, ['users:manage', 'invalidpermission']);
});
run('invalid role/status values cannot escalate privileges during normalization', () => {
    strict_1.default.equal((0, admin_user_management_js_1.normalizeUserRole)('superadmin', 'user'), 'user');
    strict_1.default.equal((0, admin_user_management_js_1.normalizeAccountStatus)('banned', 'inactive'), 'inactive');
});
if (failed > 0)
    process.exit(1);
