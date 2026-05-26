"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPaidFeatureAccess = hasPaidFeatureAccess;
exports.getDashboardFeatureAccess = getDashboardFeatureAccess;
exports.buildUpgradeContext = buildUpgradeContext;
function isFlagEnabled(records, key, defaultEnabled = true) {
    const row = records[key];
    if (!row)
        return defaultEnabled;
    return row.enabled !== false;
}
function hasPaidFeatureAccess(entitlements) {
    return (entitlements.plan === 'admin' ||
        entitlements.plan === 'premium' ||
        entitlements.plan === 'pro' ||
        entitlements.plan === 'promo_pro' ||
        Boolean(entitlements.hasPro));
}
function getDashboardFeatureAccess(key, entitlements, records) {
    const paidAccess = hasPaidFeatureAccess(entitlements);
    if (key === 'global_chat') {
        const enabled = isFlagEnabled(records, 'global_chat_enabled', true);
        const proRequired = true;
        const allowed = enabled && (paidAccess || entitlements.plan === 'admin');
        return {
            key,
            label: 'Global Chat',
            enabled,
            proRequired,
            paidAccess,
            allowed,
            code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
            message: enabled ? 'Global Chat requires Pro.' : 'Global Chat is currently disabled.',
        };
    }
    if (key === 'knowledge_hub') {
        const enabled = isFlagEnabled(records, 'enable_knowledge_hub', true);
        const proRequired = isFlagEnabled(records, 'pro_required_knowledge_hub', true);
        const allowed = enabled && (!proRequired || paidAccess || entitlements.plan === 'admin');
        return {
            key,
            label: 'Knowledge Hub',
            enabled,
            proRequired,
            paidAccess,
            allowed,
            code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
            message: enabled ? 'Knowledge Hub requires Pro.' : 'Knowledge Hub is currently disabled.',
        };
    }
    if (key === 'exam_prediction') {
        const enabled = isFlagEnabled(records, 'enable_exam_prediction', true);
        const proRequired = isFlagEnabled(records, 'pro_required_exam_prediction', true);
        const allowed = enabled && (!proRequired || paidAccess || entitlements.plan === 'admin');
        return {
            key,
            label: 'Exam Prediction Engine',
            enabled,
            proRequired,
            paidAccess,
            allowed,
            code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
            message: enabled ? 'Exam Prediction Engine requires Pro.' : 'Exam Prediction Engine is currently disabled.',
        };
    }
    const enabled = isFlagEnabled(records, 'enable_practice_exam_generation', true);
    const proRequired = true;
    const allowed = enabled && (paidAccess || entitlements.plan === 'admin');
    return {
        key,
        label: 'Practice Exam Center',
        enabled,
        proRequired,
        paidAccess,
        allowed,
        code: enabled ? (allowed ? null : 'PRO_REQUIRED') : 'FEATURE_DISABLED',
        message: enabled ? 'Practice Exam Center requires Pro.' : 'Practice Exam Center is currently disabled.',
    };
}
function buildUpgradeContext(access) {
    return {
        code: access.code || 'PRO_REQUIRED',
        reason: access.message,
        message: access.message,
        key: access.key,
        limit: access.key,
        used: 0,
        cta: 'Upgrade to Pro',
        upgradeUrl: `/pricing?source=feature_${encodeURIComponent(access.key)}`,
    };
}
