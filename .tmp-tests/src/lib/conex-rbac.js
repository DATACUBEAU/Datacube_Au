"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONEX_ROOT_ADMIN_USER_ID = exports.CONEX_ROOT_ADMIN_EMAIL_FALLBACK = exports.CONEX_ROOT_ADMIN_EMAIL = void 0;
exports.normalizeConexTier = normalizeConexTier;
exports.isRootConexAdmin = isRootConexAdmin;
exports.hasConexAccess = hasConexAccess;
exports.toConexTierFromToggle = toConexTierFromToggle;
exports.CONEX_ROOT_ADMIN_EMAIL = 'fabiansazzy1214@gmail.com';
exports.CONEX_ROOT_ADMIN_EMAIL_FALLBACK = 'fabiansazzy121@gmail.com';
exports.CONEX_ROOT_ADMIN_USER_ID = '05ad2f16-b3ce-48eb-bf24-41b407556ffd';
function normalizeConexTier(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'admin')
        return 'admin';
    if (normalized === 'free')
        return 'free';
    return null;
}
function isRootConexAdmin(userId, email) {
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const emailMatch = normalizedEmail === exports.CONEX_ROOT_ADMIN_EMAIL || normalizedEmail === exports.CONEX_ROOT_ADMIN_EMAIL_FALLBACK;
    const idMatch = userId === exports.CONEX_ROOT_ADMIN_USER_ID;
    // Allow either verified root email or known root user_id.
    // This prevents lockout when auth provider/user migration changes one side.
    return emailMatch || idMatch;
}
function hasConexAccess(subject) {
    if (isRootConexAdmin(subject.userId, subject.email))
        return true;
    return normalizeConexTier(subject.tier) === 'admin';
}
function toConexTierFromToggle(enabled) {
    return enabled ? 'admin' : 'free';
}
