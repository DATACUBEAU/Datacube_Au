"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const conex_rbac_js_1 = require("../src/lib/conex-rbac.js");
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
run('isRootConexAdmin allows bootstrap identity by known id or known email aliases', () => {
    strict_1.default.equal((0, conex_rbac_js_1.isRootConexAdmin)(conex_rbac_js_1.CONEX_ROOT_ADMIN_USER_ID, conex_rbac_js_1.CONEX_ROOT_ADMIN_EMAIL), true);
    strict_1.default.equal((0, conex_rbac_js_1.isRootConexAdmin)(conex_rbac_js_1.CONEX_ROOT_ADMIN_USER_ID, 'wrong@example.com'), true);
    strict_1.default.equal((0, conex_rbac_js_1.isRootConexAdmin)('00000000-0000-0000-0000-000000000000', conex_rbac_js_1.CONEX_ROOT_ADMIN_EMAIL), true);
    strict_1.default.equal((0, conex_rbac_js_1.isRootConexAdmin)('00000000-0000-0000-0000-000000000000', 'not-admin@example.com'), false);
});
run('hasConexAccess allows admin tier and denies free tier', () => {
    strict_1.default.equal((0, conex_rbac_js_1.hasConexAccess)({ userId: '11111111-1111-4111-8111-111111111111', email: 'user@example.com', tier: 'admin' }), true);
    strict_1.default.equal((0, conex_rbac_js_1.hasConexAccess)({ userId: '11111111-1111-4111-8111-111111111111', email: 'user@example.com', tier: 'free' }), false);
});
run('normalizeConexTier and toggle mapping are strict', () => {
    strict_1.default.equal((0, conex_rbac_js_1.normalizeConexTier)('admin'), 'admin');
    strict_1.default.equal((0, conex_rbac_js_1.normalizeConexTier)('free'), 'free');
    strict_1.default.equal((0, conex_rbac_js_1.normalizeConexTier)('pro'), null);
    strict_1.default.equal((0, conex_rbac_js_1.toConexTierFromToggle)(true), 'admin');
    strict_1.default.equal((0, conex_rbac_js_1.toConexTierFromToggle)(false), 'free');
});
if (failed > 0)
    process.exit(1);
