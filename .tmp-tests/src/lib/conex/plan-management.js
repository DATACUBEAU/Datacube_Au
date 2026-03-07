"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderPlanKeys = orderPlanKeys;
exports.formatPlanLabel = formatPlanLabel;
exports.parsePlanLimitsPayload = parsePlanLimitsPayload;
exports.toPlanLimitDraftByPlan = toPlanLimitDraftByPlan;
exports.sanitizeLimitInput = sanitizeLimitInput;
exports.validatePlanLimitDraft = validatePlanLimitDraft;
const KNOWN_PLAN_ORDER = ['free', 'pro', 'premium', 'weekly', 'monthly'];
const MAX_LIMIT_VALUE = 1000000000;
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function normalizePlanKey(value) {
    return String(value ?? '').trim().toLowerCase();
}
function normalizeLimitValue(raw) {
    if (raw === null || raw === undefined || raw === '')
        return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric))
        return null;
    const clamped = Math.max(0, Math.floor(numeric));
    return clamped > MAX_LIMIT_VALUE ? MAX_LIMIT_VALUE : clamped;
}
function collectPlanEntries(payload) {
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const limitsByPlan = asRecord(data.limitsByPlan && typeof data.limitsByPlan === 'object' ? data.limitsByPlan : null);
    if (Object.keys(limitsByPlan).length > 0) {
        return Object.entries(limitsByPlan);
    }
    const rootLimitsByPlan = asRecord(root.limitsByPlan && typeof root.limitsByPlan === 'object' ? root.limitsByPlan : null);
    if (Object.keys(rootLimitsByPlan).length > 0) {
        return Object.entries(rootLimitsByPlan);
    }
    const planLimitsArray = Array.isArray(data.planLimits)
        ? data.planLimits
        : (Array.isArray(root.planLimits) ? root.planLimits : []);
    if (planLimitsArray.length > 0) {
        return planLimitsArray
            .map((entry) => {
            const row = asRecord(entry);
            const plan = normalizePlanKey(row.plan || row.plan_key || row.tier);
            return [plan, row];
        })
            .filter(([plan]) => Boolean(plan));
    }
    return [];
}
function normalizePlanLimitsEntry(rawEntry, knownFieldKeys) {
    const planObj = asRecord(rawEntry);
    const nestedLimits = asRecord(planObj.limits);
    const source = Object.keys(nestedLimits).length > 0 ? nestedLimits : planObj;
    const normalized = {};
    for (const [key, value] of Object.entries(source)) {
        const cleanKey = String(key || '').trim();
        if (!cleanKey)
            continue;
        normalized[cleanKey] = normalizeLimitValue(value);
    }
    for (const key of knownFieldKeys) {
        if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
            normalized[key] = null;
        }
    }
    return normalized;
}
function orderPlanKeys(planKeys) {
    const unique = Array.from(new Set(planKeys.map((plan) => normalizePlanKey(plan)).filter(Boolean)));
    unique.sort((a, b) => {
        const aIndex = KNOWN_PLAN_ORDER.indexOf(a);
        const bIndex = KNOWN_PLAN_ORDER.indexOf(b);
        const aKnown = aIndex >= 0;
        const bKnown = bIndex >= 0;
        if (aKnown && bKnown)
            return aIndex - bIndex;
        if (aKnown)
            return -1;
        if (bKnown)
            return 1;
        return a.localeCompare(b);
    });
    return unique;
}
function formatPlanLabel(planKey) {
    const safe = normalizePlanKey(planKey);
    if (!safe)
        return 'Unknown';
    return safe
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
function parsePlanLimitsPayload(payload, knownFieldKeys) {
    const limitsByPlan = {};
    const entries = collectPlanEntries(payload);
    for (const [rawPlan, entry] of entries) {
        const plan = normalizePlanKey(rawPlan);
        if (!plan)
            continue;
        limitsByPlan[plan] = normalizePlanLimitsEntry(entry, knownFieldKeys);
    }
    const planKeys = orderPlanKeys(Object.keys(limitsByPlan));
    return { limitsByPlan, planKeys };
}
function toPlanLimitDraftByPlan(limitsByPlan, knownFieldKeys) {
    const out = {};
    for (const [plan, limits] of Object.entries(limitsByPlan)) {
        const row = {};
        for (const key of knownFieldKeys) {
            const value = limits[key];
            row[key] = value === null || value === undefined ? '' : String(Math.max(0, Math.floor(value)));
        }
        out[plan] = row;
    }
    return out;
}
function sanitizeLimitInput(raw) {
    return String(raw ?? '').replace(/[^\d]/g, '');
}
function validatePlanLimitDraft(draftByPlan, selectedPlan, knownFieldKeys) {
    const rawDraft = asRecord(draftByPlan[selectedPlan]);
    const sanitizedDraft = {};
    const limits = {};
    const errors = [];
    for (const key of knownFieldKeys) {
        const rawValue = String(rawDraft[key] ?? '').trim();
        if (!rawValue) {
            sanitizedDraft[key] = '';
            limits[key] = 0;
            continue;
        }
        if (!/^\d+$/.test(rawValue)) {
            errors.push(`${key} must be a non-negative integer.`);
            sanitizedDraft[key] = sanitizeLimitInput(rawValue);
            continue;
        }
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric) || numeric < 0) {
            errors.push(`${key} must be a non-negative integer.`);
            sanitizedDraft[key] = '';
            continue;
        }
        const clamped = Math.min(MAX_LIMIT_VALUE, Math.floor(numeric));
        sanitizedDraft[key] = String(clamped);
        limits[key] = clamped;
    }
    return {
        ok: errors.length === 0,
        errors,
        sanitizedDraft,
        limits,
    };
}
