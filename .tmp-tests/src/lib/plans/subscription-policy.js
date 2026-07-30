"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKEN_LIMITS_BY_PLAN = exports.PREMIUM_PLAN_EXPIRATION_DAYS = exports.PAID_PRO_PLAN_EXPIRATION_DAYS = exports.PROMO_PLAN_EXPIRATION_DAYS = exports.FREE_PLAN_EXPIRATION_DAYS = exports.SIGNED_OUT_DOCUMENT_CLEANUP_DAYS = void 0;
exports.computeUtcQuotaWindowBounds = computeUtcQuotaWindowBounds;
exports.normalizeManagedPlan = normalizeManagedPlan;
exports.normalizeEntitlementSource = normalizeEntitlementSource;
exports.resolvePlanExpirationDays = resolvePlanExpirationDays;
exports.formatExpirationWindowLabel = formatExpirationWindowLabel;
exports.getRetentionPolicyNotice = getRetentionPolicyNotice;
exports.prorateExpirationTimestamp = prorateExpirationTimestamp;
exports.resolvePlanTransitionKind = resolvePlanTransitionKind;
const DAY_MS = 24 * 60 * 60 * 1000;
exports.SIGNED_OUT_DOCUMENT_CLEANUP_DAYS = 7;
exports.FREE_PLAN_EXPIRATION_DAYS = 14;
exports.PROMO_PLAN_EXPIRATION_DAYS = 14;
exports.PAID_PRO_PLAN_EXPIRATION_DAYS = 30;
exports.PREMIUM_PLAN_EXPIRATION_DAYS = 30;
exports.TOKEN_LIMITS_BY_PLAN = {
    free: 4000,
    pro: 18000,
    premium: 45000,
};
function computeUtcQuotaWindowBounds(resetEveryDays, now = new Date()) {
    const safeDays = Math.floor(Number(resetEveryDays) || 0);
    if (safeDays <= 0) {
        return {
            start: '1970-01-01T00:00:00.000Z',
            end: null,
        };
    }
    const utcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const epochDay = Math.floor(utcMidnightMs / DAY_MS);
    const windowStartDay = epochDay - (epochDay % safeDays);
    const startMs = windowStartDay * DAY_MS;
    const endMs = startMs + safeDays * DAY_MS;
    return {
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
    };
}
function normalizeManagedPlan(plan) {
    const value = String(plan || '').trim().toLowerCase();
    if (value === 'premium')
        return 'premium';
    if (value === 'pro' || value === 'promo_pro' || value === 'admin' || value === 'weekly' || value === 'monthly' || value === 'paid') {
        return 'pro';
    }
    return 'free';
}
function normalizeEntitlementSource(source) {
    const value = String(source || '').trim().toLowerCase();
    if (value === 'paid')
        return 'paid';
    if (value === 'promo')
        return 'promo';
    return 'none';
}
function resolvePlanExpirationDays(input) {
    const entitlementSource = normalizeEntitlementSource(input.entitlementSource);
    if (entitlementSource === 'promo') {
        return exports.PROMO_PLAN_EXPIRATION_DAYS;
    }
    const plan = normalizeManagedPlan(input.plan);
    if (plan === 'premium')
        return exports.PREMIUM_PLAN_EXPIRATION_DAYS;
    if (plan === 'pro')
        return exports.PAID_PRO_PLAN_EXPIRATION_DAYS;
    return exports.FREE_PLAN_EXPIRATION_DAYS;
}
function formatExpirationWindowLabel(days) {
    return `${Math.max(0, Math.floor(days || 0))} days`;
}
function getRetentionPolicyNotice() {
    const freeAndPromoLabel = `Free and Promo documents expire after ${exports.FREE_PLAN_EXPIRATION_DAYS} days.`;
    const paidProLabel = `Paid Pro documents expire after ${exports.PAID_PRO_PLAN_EXPIRATION_DAYS} days.`;
    const summary = `If you stay signed out for ${exports.SIGNED_OUT_DOCUMENT_CLEANUP_DAYS} days, your uploaded documents will be deleted. Documents uploaded on Free and Promo plans expire after ${exports.FREE_PLAN_EXPIRATION_DAYS} days. Documents uploaded on the paid Pro plan expire after ${exports.PAID_PRO_PLAN_EXPIRATION_DAYS} days.`;
    return {
        signedOutDays: exports.SIGNED_OUT_DOCUMENT_CLEANUP_DAYS,
        freeDays: exports.FREE_PLAN_EXPIRATION_DAYS,
        promoDays: exports.PROMO_PLAN_EXPIRATION_DAYS,
        paidProDays: exports.PAID_PRO_PLAN_EXPIRATION_DAYS,
        freeAndPromoLabel,
        paidProLabel,
        summary,
    };
}
function prorateExpirationTimestamp(input) {
    const now = input.now instanceof Date ? input.now : new Date();
    const nextWindowMs = Math.max(1, Math.floor(input.nextExpirationDays || 0)) * DAY_MS;
    if (nextWindowMs <= 0) {
        return now.toISOString();
    }
    const currentExpiryMs = new Date(String(input.currentExpiresAt || '')).getTime();
    if (!Number.isFinite(currentExpiryMs) || currentExpiryMs <= now.getTime()) {
        return new Date(now.getTime() + nextWindowMs).toISOString();
    }
    const previousWindowMs = Math.max(1, Math.floor(input.previousExpirationDays || 0)) * DAY_MS;
    const remainingRatio = Math.max(0, Math.min(1, (currentExpiryMs - now.getTime()) / previousWindowMs));
    return new Date(now.getTime() + Math.round(remainingRatio * nextWindowMs)).toISOString();
}
function resolvePlanTransitionKind(input) {
    const previousDays = resolvePlanExpirationDays({
        plan: input.previousPlan,
        entitlementSource: input.previousEntitlementSource,
    });
    const nextDays = resolvePlanExpirationDays({
        plan: input.nextPlan,
        entitlementSource: input.nextEntitlementSource,
    });
    if (nextDays > previousDays)
        return 'upgrade';
    if (nextDays < previousDays)
        return 'downgrade';
    const previousSource = normalizeEntitlementSource(input.previousEntitlementSource);
    const nextSource = normalizeEntitlementSource(input.nextEntitlementSource);
    if (previousSource !== nextSource || normalizeManagedPlan(input.previousPlan) !== normalizeManagedPlan(input.nextPlan)) {
        return 'renewal';
    }
    return 'sync';
}
