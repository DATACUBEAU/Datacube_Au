"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_OVERRIDE_PLANS = exports.PLATFORM_OWNER_USER_ID = void 0;
exports.getProtectedOwnerUserId = getProtectedOwnerUserId;
exports.isProtectedOwnerUserId = isProtectedOwnerUserId;
exports.normalizeAdminOverridePlan = normalizeAdminOverridePlan;
exports.isAdminOverridePlan = isAdminOverridePlan;
exports.isPaidAdminOverridePlan = isPaidAdminOverridePlan;
exports.adminOverridePlanLabel = adminOverridePlanLabel;
exports.PLATFORM_OWNER_USER_ID = '05ad2f16-b3ce-48eb-bf24-41b407556ffd';
function getProtectedOwnerUserId() {
    const configured = typeof process !== 'undefined'
        ? process.env?.DATACUBE_OWNER_ADMIN_USER_ID
        : null;
    return String(configured || exports.PLATFORM_OWNER_USER_ID).trim().toLowerCase();
}
exports.ADMIN_OVERRIDE_PLANS = ['free', 'pro_weekly', 'pro_monthly', 'premium'];
const ADMIN_OVERRIDE_PLAN_SET = new Set(exports.ADMIN_OVERRIDE_PLANS);
function isProtectedOwnerUserId(userId) {
    return String(userId || '').trim().toLowerCase() === getProtectedOwnerUserId();
}
function normalizeAdminOverridePlan(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'free')
        return 'free';
    if (normalized === 'premium')
        return 'premium';
    if (normalized === 'weekly' || normalized === 'pro_weekly')
        return 'pro_weekly';
    if (normalized === 'monthly' || normalized === 'pro_monthly' || normalized === 'pro')
        return 'pro_monthly';
    return ADMIN_OVERRIDE_PLAN_SET.has(normalized) ? normalized : null;
}
function isAdminOverridePlan(value) {
    return normalizeAdminOverridePlan(value) === value;
}
function isPaidAdminOverridePlan(value) {
    const normalized = normalizeAdminOverridePlan(value);
    return normalized === 'pro_weekly' || normalized === 'pro_monthly' || normalized === 'premium';
}
function adminOverridePlanLabel(value) {
    if (value === 'premium')
        return 'Premium';
    if (value === 'pro_weekly')
        return 'Pro Weekly';
    if (value === 'pro_monthly')
        return 'Pro Monthly';
    return 'Free';
}
