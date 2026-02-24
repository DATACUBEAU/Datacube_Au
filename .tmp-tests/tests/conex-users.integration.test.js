"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const conex_rbac_js_1 = require("../src/lib/conex-rbac.js");
const conex_users_service_js_1 = require("../src/lib/server/conex-users-service.js");
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
class InMemoryConexRepo {
    constructor(seed) {
        this.rows = new Map(seed.map((row) => [row.user_id, { ...row }]));
    }
    async getProfileByUserId(userId) {
        return this.rows.get(userId) ?? null;
    }
    async listProfiles() {
        return [...this.rows.values()];
    }
    async upsertTier(userId, tier) {
        const existing = this.rows.get(userId);
        const next = {
            user_id: userId,
            tier,
            full_name: existing?.full_name ?? null,
            avatar_url: existing?.avatar_url ?? null,
        };
        this.rows.set(userId, next);
        return next;
    }
}
const bootstrapAdmin = {
    user_id: conex_rbac_js_1.CONEX_ROOT_ADMIN_USER_ID,
    tier: 'admin',
    full_name: 'Root Admin',
    avatar_url: 'https://example.com/root.png',
};
const targetUser = {
    user_id: '91f4f16d-211d-4eb8-8ed1-2f41f2a6f4e4',
    tier: 'free',
    full_name: 'Target User',
    avatar_url: 'https://example.com/target.png',
};
const freeActor = {
    user_id: 'b5415935-3bb9-4e3b-a4f6-e12f95b31f40',
    tier: 'free',
    full_name: 'No Access',
    avatar_url: 'https://example.com/noaccess.png',
};
run('access control cannot be bypassed by non-admin actor', async () => {
    const repo = new InMemoryConexRepo([bootstrapAdmin, targetUser, freeActor]);
    await strict_1.default.rejects(async () => {
        await (0, conex_users_service_js_1.setConexTierForUser)(repo, { userId: freeActor.user_id, email: 'unauthorized@example.com' }, targetUser.user_id, 'admin');
    }, (error) => error instanceof conex_users_service_js_1.ConexAccessError &&
        error.status === 403 &&
        error.code === 'forbidden');
});
run('toggle switch persistence updates tier in repository', async () => {
    const repo = new InMemoryConexRepo([bootstrapAdmin, targetUser]);
    const updated = await (0, conex_users_service_js_1.setConexTierForUser)(repo, { userId: conex_rbac_js_1.CONEX_ROOT_ADMIN_USER_ID, email: conex_rbac_js_1.CONEX_ROOT_ADMIN_EMAIL }, targetUser.user_id, 'admin');
    strict_1.default.equal(updated.tier, 'admin');
    const persisted = await repo.getProfileByUserId(targetUser.user_id);
    strict_1.default.equal(persisted?.tier, 'admin');
});
run('dashboard list includes authorized users with avatar_url and full_name', async () => {
    const repo = new InMemoryConexRepo([bootstrapAdmin, targetUser]);
    await (0, conex_users_service_js_1.setConexTierForUser)(repo, { userId: conex_rbac_js_1.CONEX_ROOT_ADMIN_USER_ID, email: conex_rbac_js_1.CONEX_ROOT_ADMIN_EMAIL }, targetUser.user_id, 'admin');
    const dashboard = await (0, conex_users_service_js_1.listConexDashboardUsers)(repo, {
        userId: conex_rbac_js_1.CONEX_ROOT_ADMIN_USER_ID,
        email: conex_rbac_js_1.CONEX_ROOT_ADMIN_EMAIL,
    });
    const authorizedTarget = dashboard.authorizedUsers.find((user) => user.user_id === targetUser.user_id);
    strict_1.default.ok(authorizedTarget);
    strict_1.default.equal(authorizedTarget?.full_name, 'Target User');
    strict_1.default.equal(authorizedTarget?.avatar_url, 'https://example.com/target.png');
});
process.on('beforeExit', () => {
    if (failed > 0)
        process.exitCode = 1;
});
