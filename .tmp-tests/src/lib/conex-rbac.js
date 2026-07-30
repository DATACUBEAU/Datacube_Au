"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONEX_ROOT_ADMIN_USER_ID = exports.CONEX_ROOT_ADMIN_EMAIL_FALLBACK = exports.CONEX_ROOT_ADMIN_EMAIL = void 0;
exports.normalizeConexTier = normalizeConexTier;
exports.isRootConexAdmin = isRootConexAdmin;
exports.hasConexAccess = hasConexAccess;
exports.toConexTierFromToggle = toConexTierFromToggle;
const protected_owner_1 = require("./admin/protected-owner");
exports.CONEX_ROOT_ADMIN_EMAIL = String(process.env.CONEX_ROOT_ADMIN_EMAIL ?? '')
    .trim()
    .toLowerCase();
exports.CONEX_ROOT_ADMIN_EMAIL_FALLBACK = String(process.env.CONEX_ROOT_ADMIN_EMAIL_FALLBACK ?? '')
    .trim()
    .toLowerCase();
exports.CONEX_ROOT_ADMIN_USER_ID = (0, protected_owner_1.getProtectedOwnerUserId)();
function normalizeConexTier(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'admin')
        return 'admin';
    if (normalized === 'free')
        return 'free';
    return null;
}
function isRootConexAdmin(userId, email) {
    void email;
    return (0, protected_owner_1.isProtectedOwnerUserId)(userId);
}
function hasConexAccess(subject) {
    return isRootConexAdmin(subject.userId, subject.email);
}
function toConexTierFromToggle(enabled) {
    return enabled ? 'admin' : 'free';
}
