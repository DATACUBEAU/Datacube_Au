"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConexAccessError = void 0;
exports.assertConexUserId = assertConexUserId;
exports.assertActorCanManageConex = assertActorCanManageConex;
exports.buildConexDashboardUsers = buildConexDashboardUsers;
exports.listConexDashboardUsers = listConexDashboardUsers;
exports.setConexTierForUser = setConexTierForUser;
const conex_rbac_1 = require("../conex-rbac");
class ConexAccessError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.ConexAccessError = ConexAccessError;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertConexUserId(userId) {
    if (!UUID_RE.test(String(userId ?? ''))) {
        throw new ConexAccessError(400, 'invalid_user_id', 'Invalid user_id. Expected UUID.');
    }
}
function assertActorCanManageConex(actor, profile) {
    const isAllowed = (0, conex_rbac_1.hasConexAccess)({
        userId: actor.userId,
        email: actor.email ?? null,
        tier: profile?.tier ?? null,
    });
    if (!isAllowed) {
        throw new ConexAccessError(403, 'forbidden', 'Forbidden: admin tier required for /conex access management.');
    }
}
function buildConexDashboardUsers(rows) {
    const users = rows.map((row) => {
        const tier = (0, conex_rbac_1.normalizeConexTier)(row.tier) ?? 'free';
        const item = {
            user_id: row.user_id,
            tier,
            full_name: row.full_name ?? null,
            avatar_url: row.avatar_url ?? null,
            is_authorized: tier === 'admin',
        };
        return item;
    });
    users.sort((a, b) => {
        if (a.is_authorized !== b.is_authorized)
            return a.is_authorized ? -1 : 1;
        const aName = (a.full_name || a.user_id).toLowerCase();
        const bName = (b.full_name || b.user_id).toLowerCase();
        return aName.localeCompare(bName);
    });
    return {
        users,
        authorizedUsers: users.filter((user) => user.is_authorized),
    };
}
async function listConexDashboardUsers(repo, actor) {
    const actorProfile = await repo.getProfileByUserId(actor.userId);
    assertActorCanManageConex(actor, actorProfile);
    const rows = await repo.listProfiles();
    return buildConexDashboardUsers(rows);
}
async function setConexTierForUser(repo, actor, targetUserId, nextTierRaw) {
    const actorProfile = await repo.getProfileByUserId(actor.userId);
    assertActorCanManageConex(actor, actorProfile);
    assertConexUserId(targetUserId);
    const nextTier = (0, conex_rbac_1.normalizeConexTier)(nextTierRaw);
    if (!nextTier) {
        throw new ConexAccessError(400, 'invalid_tier', "Invalid tier. Expected 'admin' or 'free'.");
    }
    if (targetUserId === conex_rbac_1.CONEX_ROOT_ADMIN_USER_ID && nextTier !== 'admin') {
        throw new ConexAccessError(400, 'protected_user', 'Cannot revoke root admin access.');
    }
    const updated = await repo.upsertTier(targetUserId, nextTier);
    if (!updated) {
        throw new ConexAccessError(500, 'update_failed', 'Failed to update user tier.');
    }
    const tier = (0, conex_rbac_1.normalizeConexTier)(updated.tier) ?? nextTier;
    return {
        user_id: updated.user_id,
        tier,
        full_name: updated.full_name ?? null,
        avatar_url: updated.avatar_url ?? null,
        is_authorized: tier === 'admin',
    };
}
