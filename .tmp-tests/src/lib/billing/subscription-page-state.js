'use client';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBSCRIPTION_USAGE_KEYS = void 0;
exports.buildSubscriptionBootstrapKey = buildSubscriptionBootstrapKey;
exports.hasMeaningfulSubscriptionUsageData = hasMeaningfulSubscriptionUsageData;
exports.buildSubscriptionUsageRows = buildSubscriptionUsageRows;
const plan_refresh_state_1 = require("./plan-refresh-state");
exports.SUBSCRIPTION_USAGE_KEYS = [
    'max_chats_total',
    'max_uploads_total',
    'max_tokens_total',
    'max_file_size_mb',
    'max_concurrent_jobs',
    'max_exam_predictions',
    'max_practice_exams',
    'max_knowledge_hub',
];
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function humanizeUsageKey(key) {
    return key
        .replace(/^max_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function buildPaymentReturnSignature(paymentReturn) {
    return [
        paymentReturn.reference || '',
        paymentReturn.verificationTarget || '',
        paymentReturn.transactionId || '',
        paymentReturn.gatewayHint || '',
        paymentReturn.isSuccess ? '1' : '0',
        paymentReturn.isCanceled ? '1' : '0',
        paymentReturn.hasCallbackState ? '1' : '0',
    ].join('|');
}
function buildSubscriptionBootstrapKey(userId, paymentReturn) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId)
        return null;
    return `${normalizedUserId}:${buildPaymentReturnSignature(paymentReturn)}`;
}
function hasMeaningfulSubscriptionUsageData(usage) {
    const usageByLimit = usage.usageByLimit || {};
    const limitRules = usage.limitRules || {};
    const limits = usage.limits || {};
    return exports.SUBSCRIPTION_USAGE_KEYS.some((key) => {
        return (Object.keys(asRecord(usageByLimit[key])).length > 0 ||
            Object.keys(asRecord(limitRules[key])).length > 0 ||
            asFiniteNumber(limits[key]) !== null);
    });
}
function buildSubscriptionUsageRows(input) {
    const planCode = (0, plan_refresh_state_1.resolveDisplayedPlanCode)({
        snapshot: input.snapshot,
        currentPlanManagedPlan: input.currentPlanManagedPlan,
        tier: input.tier,
        limitsUsagePlan: input.usage.plan,
    });
    if (!planCode) {
        return {
            planCode: null,
            isFreePlan: false,
            hasData: false,
            resetSummary: [],
            rows: [],
        };
    }
    const rows = exports.SUBSCRIPTION_USAGE_KEYS.reduce((acc, key) => {
        const rule = asRecord(input.usage.limitRules[key]);
        const presentation = asRecord(rule.presentation);
        const usageEntry = asRecord(input.usage.usageByLimit[key]);
        const reset = asRecord(usageEntry.reset);
        const rawLimit = usageEntry.limit === null || rule.is_unlimited === true
            ? null
            : (usageEntry.limit ?? input.usage.limits[key] ?? rule.value);
        const parsedLimit = rawLimit === null ? null : asFiniteNumber(rawLimit);
        const used = asFiniteNumber(usageEntry.used) ?? 0;
        const label = asString(presentation.label) ||
            asString(rule.label) ||
            humanizeUsageKey(key);
        const resetText = asString(reset.label) ||
            asString(presentation.reset_description) ||
            asString(presentation.reset_label);
        const hasAnyData = Object.keys(rule).length > 0 ||
            Object.keys(usageEntry).length > 0 ||
            parsedLimit !== null ||
            rawLimit === null;
        if (!hasAnyData)
            return acc;
        acc.push({
            key,
            label,
            used,
            limit: parsedLimit,
            resetText,
        });
        return acc;
    }, []);
    return {
        planCode,
        isFreePlan: planCode === 'free',
        hasData: rows.length > 0,
        resetSummary: rows
            .map((row) => row.resetText)
            .filter(Boolean)
            .slice(0, 2),
        rows,
    };
}
