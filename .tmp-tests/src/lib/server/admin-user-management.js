"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_ROLES = exports.ACCOUNT_STATUSES = void 0;
exports.normalizeAccountStatus = normalizeAccountStatus;
exports.normalizeUserRole = normalizeUserRole;
exports.normalizePermissions = normalizePermissions;
exports.roleToTier = roleToTier;
exports.buildAppMetadataPatch = buildAppMetadataPatch;
exports.filterManagedUsers = filterManagedUsers;
exports.validateBulkUserIds = validateBulkUserIds;
exports.ACCOUNT_STATUSES = ['active', 'inactive', 'suspended'];
exports.USER_ROLES = ['admin', 'free', 'weekly', 'monthly', 'pro', 'user'];
function normalizeAccountStatus(value, fallback = 'active') {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'active')
        return 'active';
    if (normalized === 'inactive')
        return 'inactive';
    if (normalized === 'suspended')
        return 'suspended';
    return fallback;
}
function normalizeUserRole(value, fallback = 'user') {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'admin')
        return 'admin';
    if (normalized === 'free')
        return 'free';
    if (normalized === 'weekly')
        return 'weekly';
    if (normalized === 'monthly')
        return 'monthly';
    if (normalized === 'pro')
        return 'pro';
    if (normalized === 'user')
        return 'user';
    return fallback;
}
function normalizePermissions(value) {
    if (!Array.isArray(value))
        return [];
    const unique = new Set();
    for (const raw of value) {
        const normalized = String(raw ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9:_-]/g, '');
        if (!normalized)
            continue;
        unique.add(normalized);
    }
    return [...unique];
}
function roleToTier(role) {
    const normalized = normalizeUserRole(role, 'user');
    if (normalized === 'admin')
        return 'admin';
    if (normalized === 'free')
        return 'free';
    if (normalized === 'weekly')
        return 'weekly';
    if (normalized === 'monthly')
        return 'monthly';
    if (normalized === 'pro')
        return 'monthly';
    return null;
}
function buildAppMetadataPatch(current, patch) {
    const next = { ...(current ?? {}) };
    if (patch.status !== undefined) {
        next.account_status = normalizeAccountStatus(patch.status);
    }
    if (patch.role !== undefined) {
        next.role = normalizeUserRole(patch.role);
    }
    if (patch.permissions !== undefined) {
        next.permissions = normalizePermissions(patch.permissions);
    }
    return next;
}
function filterManagedUsers(rows, filters) {
    const normalizedQ = String(filters.q ?? '').trim().toLowerCase();
    const status = filters.status ?? 'all';
    const role = filters.role ?? 'all';
    const presence = filters.presence ?? 'all';
    const sortBy = filters.sortBy ?? 'last_active_at';
    const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc';
    const onlineWindowMs = 5 * 60 * 1000;
    let filtered = rows.slice();
    if (status !== 'all') {
        filtered = filtered.filter((row) => row.account_status === status);
    }
    if (role !== 'all') {
        filtered = filtered.filter((row) => row.role === role);
    }
    if (presence !== 'all') {
        filtered = filtered.filter((row) => {
            const timestamp = row.last_active_at ? new Date(String(row.last_active_at)).getTime() : 0;
            const online = timestamp > 0 && Date.now() - timestamp <= onlineWindowMs;
            return presence === 'online' ? online : !online;
        });
    }
    if (normalizedQ) {
        filtered = filtered.filter((row) => {
            const email = String(row.email ?? '').toLowerCase();
            const name = String(row.full_name ?? '').toLowerCase();
            const userId = String(row.user_id ?? '').toLowerCase();
            return email.includes(normalizedQ) || name.includes(normalizedQ) || userId.includes(normalizedQ);
        });
    }
    const direction = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (sortBy.endsWith('_at')) {
            const aTs = aVal ? new Date(String(aVal)).getTime() : 0;
            const bTs = bVal ? new Date(String(bVal)).getTime() : 0;
            return direction * (aTs - bTs);
        }
        return direction * String(aVal ?? '').localeCompare(String(bVal ?? ''));
    });
    return filtered;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateBulkUserIds(value, max = 200) {
    if (!Array.isArray(value)) {
        throw new Error('Expected userIds array.');
    }
    const unique = [...new Set(value.map((item) => String(item ?? '').trim()))].filter(Boolean);
    if (unique.length === 0) {
        throw new Error('userIds array is empty.');
    }
    if (unique.length > max) {
        throw new Error(`Too many user IDs. Maximum is ${max}.`);
    }
    for (const userId of unique) {
        if (!UUID_RE.test(userId)) {
            throw new Error(`Invalid user ID: ${userId}`);
        }
    }
    return unique;
}
