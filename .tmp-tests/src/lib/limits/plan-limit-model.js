"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PLAN_LIMITS = exports.PLAN_LIMIT_DEFINITIONS = exports.PLAN_LIMIT_STATE_VALUES = exports.PLAN_LIMIT_RESET_INTERVAL_UNIT_VALUES = exports.PLAN_LIMIT_RESET_POLICY_VALUES = exports.PLAN_LIMIT_MODE_VALUES = exports.APPROVED_LIMIT_KEYS = exports.PLAN_LIMIT_SCOPE_KEYS = exports.DEFAULT_PLAN_ORDER = void 0;
exports.normalizePlanLimitMode = normalizePlanLimitMode;
exports.normalizePlanLimitResetPolicy = normalizePlanLimitResetPolicy;
exports.normalizePlanLimitResetIntervalUnit = normalizePlanLimitResetIntervalUnit;
exports.resolvePlanLimitState = resolvePlanLimitState;
exports.applyPlanLimitState = applyPlanLimitState;
exports.buildDefaultPlanLimitRule = buildDefaultPlanLimitRule;
exports.buildSeedScopeRules = buildSeedScopeRules;
exports.buildDefaultRuleSet = buildDefaultRuleSet;
exports.buildSeedPlanRuleSet = buildSeedPlanRuleSet;
exports.normalizeStoredPlanLimitRule = normalizeStoredPlanLimitRule;
exports.arePlanLimitRulesEqual = arePlanLimitRulesEqual;
exports.mergePlanLimitRuleSets = mergePlanLimitRuleSets;
exports.ruleSetToNumericLimits = ruleSetToNumericLimits;
exports.getLimitCap = getLimitCap;
exports.describeResetPolicy = describeResetPolicy;
exports.describePlanLimitMode = describePlanLimitMode;
exports.describePlanLimitResetLabel = describePlanLimitResetLabel;
exports.formatPlanLimitCap = formatPlanLimitCap;
exports.describePlanLimitResetBehavior = describePlanLimitResetBehavior;
exports.buildPlanLimitPresentation = buildPlanLimitPresentation;
exports.computeResetWindow = computeResetWindow;
exports.formatScopeLabel = formatScopeLabel;
exports.DEFAULT_PLAN_ORDER = ['free', 'pro', 'premium'];
exports.PLAN_LIMIT_SCOPE_KEYS = ['default', ...exports.DEFAULT_PLAN_ORDER];
exports.APPROVED_LIMIT_KEYS = [
    'max_chats_total',
    'max_uploads_total',
    'max_tokens_total',
    'max_file_size_mb',
    'max_concurrent_jobs',
    'max_exam_predictions',
    'max_practice_exams',
    'max_knowledge_hub',
];
exports.PLAN_LIMIT_MODE_VALUES = ['usage', 'current', 'per_request', 'concurrency'];
exports.PLAN_LIMIT_RESET_POLICY_VALUES = ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'];
exports.PLAN_LIMIT_RESET_INTERVAL_UNIT_VALUES = ['hour', 'day', 'week', 'month'];
exports.PLAN_LIMIT_STATE_VALUES = ['capped', 'unlimited', 'disabled'];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const EPOCH_START_ISO = '1970-01-01T00:00:00.000Z';
const ISO_WEEK_REFERENCE_MS = Date.UTC(1970, 0, 5, 0, 0, 0, 0);
exports.PLAN_LIMIT_DEFINITIONS = {
    max_chats_total: {
        key: 'max_chats_total',
        label: 'Chats',
        description: 'Chat requests that can create new AU chat answers within the active quota window.',
        unitLabel: 'messages',
        category: 'usage_counter',
        defaultMode: 'usage',
        supportedModes: ['usage'],
        defaultResetPolicy: 'daily',
        supportedResetPolicies: ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'],
        enforcedBy: ['/api/proxy/chat', '/api/proxy/au-chat', '/api/proxy/global-chat', 'public.au_messages'],
    },
    max_uploads_total: {
        key: 'max_uploads_total',
        label: 'Uploads',
        description: 'Uploaded files stored for the account. Deleting files frees capacity when this runs in current-count mode.',
        unitLabel: 'files',
        category: 'stored_item',
        defaultMode: 'current',
        supportedModes: ['current', 'usage'],
        defaultResetPolicy: 'never',
        supportedResetPolicies: ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'],
        enforcedBy: ['/api/proxy/document-upload', 'public.au_documents'],
    },
    max_tokens_total: {
        key: 'max_tokens_total',
        label: 'Tokens',
        description: 'Model tokens consumed by new AI runs within the active quota window.',
        unitLabel: 'tokens',
        category: 'usage_counter',
        defaultMode: 'usage',
        supportedModes: ['usage'],
        defaultResetPolicy: 'daily',
        supportedResetPolicies: ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'],
        enforcedBy: ['/api/proxy/chat', '/api/proxy/au-chat', '/api/proxy/global-chat', 'public.au_model_usage'],
    },
    max_file_size_mb: {
        key: 'max_file_size_mb',
        label: 'File Size',
        description: 'Maximum size allowed for a single uploaded file.',
        unitLabel: 'MB',
        category: 'per_request',
        defaultMode: 'per_request',
        supportedModes: ['per_request'],
        defaultResetPolicy: 'never',
        supportedResetPolicies: ['never'],
        enforcedBy: ['/api/proxy/document-upload'],
    },
    max_concurrent_jobs: {
        key: 'max_concurrent_jobs',
        label: 'Concurrent Jobs',
        description: 'Active ingestion jobs allowed at the same time.',
        unitLabel: 'jobs',
        category: 'runtime',
        defaultMode: 'concurrency',
        supportedModes: ['concurrency'],
        defaultResetPolicy: 'never',
        supportedResetPolicies: ['never'],
        enforcedBy: ['/api/proxy/document-upload', 'public.au_worker_jobs'],
    },
    max_exam_predictions: {
        key: 'max_exam_predictions',
        label: 'Exam Predictions',
        description: 'New exam prediction generations allowed inside the active quota window.',
        unitLabel: 'generations',
        category: 'usage_counter',
        defaultMode: 'usage',
        supportedModes: ['usage', 'current'],
        defaultResetPolicy: 'never',
        supportedResetPolicies: ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'],
        enforcedBy: ['/api/proxy/prediction-engine', '/api/proxy/generate-exam-predictions', 'public.au_feature_outputs'],
    },
    max_practice_exams: {
        key: 'max_practice_exams',
        label: 'Practice Exams',
        description: 'New practice exam generations allowed inside the active quota window.',
        unitLabel: 'generations',
        category: 'usage_counter',
        defaultMode: 'usage',
        supportedModes: ['usage', 'current'],
        defaultResetPolicy: 'never',
        supportedResetPolicies: ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'],
        enforcedBy: ['/api/proxy/exam-generator', '/api/proxy/generate-practice-exam', 'public.au_feature_outputs'],
    },
    max_knowledge_hub: {
        key: 'max_knowledge_hub',
        label: 'Knowledge Hub',
        description: 'Stored knowledge hub outputs available for the account. Clearing generated knowledge frees capacity.',
        unitLabel: 'items',
        category: 'stored_item',
        defaultMode: 'current',
        supportedModes: ['current', 'usage'],
        defaultResetPolicy: 'never',
        supportedResetPolicies: ['hourly', 'daily', 'weekly', 'monthly', 'never', 'custom'],
        enforcedBy: ['/api/proxy/generate-knowledge', 'public.au_feature_outputs'],
    },
};
const DEFAULT_SCOPE_RULE_SEEDS = {
    default: {
        max_chats_total: { value: 3000, mode: 'usage', resetPolicy: 'daily', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_uploads_total: { value: 50, mode: 'current', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_tokens_total: { value: 4000, mode: 'usage', resetPolicy: 'daily', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_file_size_mb: { value: 50, mode: 'per_request', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_concurrent_jobs: { value: 1, mode: 'concurrency', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_exam_predictions: { value: 10, mode: 'usage', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_practice_exams: { value: 10, mode: 'usage', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_knowledge_hub: { value: 50, mode: 'current', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
    },
    free: {},
    pro: {
        max_chats_total: { value: 30000, mode: 'usage', resetPolicy: 'daily', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_uploads_total: { value: 500, mode: 'current', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_tokens_total: { value: 18000, mode: 'usage', resetPolicy: 'daily', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_concurrent_jobs: { value: 3, mode: 'concurrency', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_exam_predictions: { value: 200, mode: 'usage', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_practice_exams: { value: 200, mode: 'usage', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_knowledge_hub: { value: 500, mode: 'current', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
    },
    premium: {
        max_chats_total: { value: 100000, mode: 'usage', resetPolicy: 'daily', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_uploads_total: { value: 1500, mode: 'current', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_tokens_total: { value: 45000, mode: 'usage', resetPolicy: 'daily', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_concurrent_jobs: { value: 6, mode: 'concurrency', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_exam_predictions: { value: 1000, mode: 'usage', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_practice_exams: { value: 1000, mode: 'usage', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
        max_knowledge_hub: { value: 1500, mode: 'current', resetPolicy: 'never', resetIntervalValue: null, resetIntervalUnit: null, isEnabled: true, isUnlimited: false },
    },
};
function asInt(value, fallback) {
    if (value === null || value === undefined || value === '')
        return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0)
        return fallback;
    return Math.floor(numeric);
}
function normalizePlanLimitMode(value, fallback) {
    const normalized = String(value || '').trim().toLowerCase();
    if (exports.PLAN_LIMIT_MODE_VALUES.includes(normalized)) {
        return normalized;
    }
    return fallback;
}
function normalizePlanLimitResetPolicy(value, fallback) {
    const normalized = String(value || '').trim().toLowerCase();
    if (exports.PLAN_LIMIT_RESET_POLICY_VALUES.includes(normalized)) {
        return normalized;
    }
    return fallback;
}
function normalizePlanLimitResetIntervalUnit(value, fallback) {
    const normalized = String(value || '').trim().toLowerCase();
    if (exports.PLAN_LIMIT_RESET_INTERVAL_UNIT_VALUES.includes(normalized)) {
        return normalized;
    }
    return fallback;
}
function resolvePlanLimitState(input) {
    if (!input.isEnabled)
        return 'disabled';
    if (input.isUnlimited)
        return 'unlimited';
    return 'capped';
}
function applyPlanLimitState(rule, state) {
    if (state === 'disabled') {
        return {
            value: rule.value,
            isEnabled: false,
            isUnlimited: false,
        };
    }
    if (state === 'unlimited') {
        return {
            value: null,
            isEnabled: true,
            isUnlimited: true,
        };
    }
    return {
        value: asInt(rule.value, 0),
        isEnabled: true,
        isUnlimited: false,
    };
}
function buildDefaultPlanLimitRule(key, input) {
    const definition = exports.PLAN_LIMIT_DEFINITIONS[key];
    const seeded = DEFAULT_SCOPE_RULE_SEEDS.default[key];
    const mode = normalizePlanLimitMode(input?.mode ?? seeded?.mode, definition.defaultMode);
    const supportedModes = definition.supportedModes.includes(mode) ? mode : definition.defaultMode;
    const rawResetPolicy = normalizePlanLimitResetPolicy(input?.resetPolicy ?? seeded?.resetPolicy, definition.defaultResetPolicy);
    const resetPolicy = supportedModes === 'usage' && definition.supportedResetPolicies.includes(rawResetPolicy)
        ? rawResetPolicy
        : 'never';
    const intervalValue = resetPolicy === 'custom' ? Math.max(1, asInt(input?.resetIntervalValue ?? seeded?.resetIntervalValue, 1) || 1) : null;
    const intervalUnit = resetPolicy === 'custom'
        ? normalizePlanLimitResetIntervalUnit(input?.resetIntervalUnit ?? seeded?.resetIntervalUnit, 'day')
        : null;
    const stateApplied = applyPlanLimitState({
        value: asInt(input?.value ?? seeded?.value, 0),
        isEnabled: input?.isEnabled ?? seeded?.isEnabled ?? true,
        isUnlimited: input?.isUnlimited ?? seeded?.isUnlimited ?? false,
    }, resolvePlanLimitState({
        isEnabled: input?.isEnabled ?? seeded?.isEnabled ?? true,
        isUnlimited: input?.isUnlimited ?? seeded?.isUnlimited ?? false,
    }));
    return {
        key,
        value: stateApplied.value,
        mode: supportedModes,
        resetPolicy,
        resetIntervalValue: intervalValue,
        resetIntervalUnit: intervalUnit,
        isEnabled: stateApplied.isEnabled,
        isUnlimited: stateApplied.isUnlimited,
        updatedAt: input?.updatedAt ?? null,
    };
}
function buildSeedScopeRules(scope) {
    const seeds = DEFAULT_SCOPE_RULE_SEEDS[scope];
    return exports.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const seed = seeds[key];
        if (!seed)
            return acc;
        acc[key] = buildDefaultPlanLimitRule(key, seed);
        return acc;
    }, {});
}
function buildDefaultRuleSet() {
    return exports.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        acc[key] = buildDefaultPlanLimitRule(key, DEFAULT_SCOPE_RULE_SEEDS.default[key]);
        return acc;
    }, {});
}
function buildSeedPlanRuleSet(plan) {
    const defaults = buildDefaultRuleSet();
    const overrides = buildSeedScopeRules(plan);
    return exports.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        acc[key] = overrides[key] || defaults[key];
        return acc;
    }, {});
}
exports.DEFAULT_PLAN_LIMITS = exports.DEFAULT_PLAN_ORDER.reduce((acc, plan) => {
    const seeded = buildSeedPlanRuleSet(plan);
    acc[plan] = ruleSetToNumericLimits(seeded);
    return acc;
}, {});
function normalizeStoredPlanLimitRule(key, input, fallback) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback || buildDefaultPlanLimitRule(key);
    const modeCandidate = normalizePlanLimitMode(source.mode, base.mode);
    const definition = exports.PLAN_LIMIT_DEFINITIONS[key];
    const mode = definition.supportedModes.includes(modeCandidate) ? modeCandidate : definition.defaultMode;
    const requestedState = String(source.state || '').trim().toLowerCase();
    const fallbackState = resolvePlanLimitState(base);
    const state = exports.PLAN_LIMIT_STATE_VALUES.includes(requestedState) ? requestedState : fallbackState;
    const resetPolicyCandidate = normalizePlanLimitResetPolicy(source.resetPolicy ?? source.reset_policy, base.resetPolicy);
    const resetPolicy = mode === 'usage' && definition.supportedResetPolicies.includes(resetPolicyCandidate)
        ? resetPolicyCandidate
        : 'never';
    const next = applyPlanLimitState({
        value: asInt(source.value, base.value),
        isEnabled: source.isEnabled === undefined ? base.isEnabled : Boolean(source.isEnabled),
        isUnlimited: source.isUnlimited === undefined ? base.isUnlimited : Boolean(source.isUnlimited),
    }, state);
    return {
        key,
        value: next.value,
        mode,
        resetPolicy,
        resetIntervalValue: resetPolicy === 'custom'
            ? Math.max(1, asInt(source.resetIntervalValue ?? source.reset_interval_value, base.resetIntervalValue ?? 1) || 1)
            : null,
        resetIntervalUnit: resetPolicy === 'custom'
            ? normalizePlanLimitResetIntervalUnit(source.resetIntervalUnit ?? source.reset_interval_unit, base.resetIntervalUnit || 'day')
            : null,
        isEnabled: next.isEnabled,
        isUnlimited: next.isUnlimited,
        updatedAt: typeof source.updatedAt === 'string'
            ? source.updatedAt
            : (typeof source.updated_at === 'string' ? source.updated_at : base.updatedAt),
    };
}
function arePlanLimitRulesEqual(left, right) {
    return (left.value === right.value &&
        left.mode === right.mode &&
        left.resetPolicy === right.resetPolicy &&
        left.resetIntervalValue === right.resetIntervalValue &&
        left.resetIntervalUnit === right.resetIntervalUnit &&
        left.isEnabled === right.isEnabled &&
        left.isUnlimited === right.isUnlimited);
}
function mergePlanLimitRuleSets(input) {
    return exports.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const definition = exports.PLAN_LIMIT_DEFINITIONS[key];
        const base = input.defaultRules[key];
        const override = input.scope === 'default' ? base : input.overrides?.[key] || null;
        const selected = override || base;
        acc[key] = {
            ...selected,
            scope: input.scope,
            sourceScope: override ? input.scope : 'default',
            inherited: input.scope !== 'default' && !override,
            state: resolvePlanLimitState(selected),
            label: definition.label,
            description: definition.description,
            unitLabel: definition.unitLabel,
            category: definition.category,
            supportedModes: definition.supportedModes,
            supportedResetPolicies: definition.supportedResetPolicies,
            enforcedBy: definition.enforcedBy,
        };
        return acc;
    }, {});
}
function ruleSetToNumericLimits(rules) {
    return exports.APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const rule = rules[key];
        if (!rule.isEnabled || rule.isUnlimited || rule.value === null) {
            acc[key] = 0;
            return acc;
        }
        acc[key] = Math.max(0, Math.floor(rule.value));
        return acc;
    }, {});
}
function getLimitCap(rule) {
    if (!rule.isEnabled || rule.isUnlimited)
        return null;
    return typeof rule.value === 'number' && Number.isFinite(rule.value) ? Math.max(0, Math.floor(rule.value)) : 0;
}
function toUtcStartOfHour(now) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0);
}
function toUtcStartOfDay(now) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
}
function computeAlignedWindow(nowMs, unitMs, every) {
    const safeEvery = Math.max(1, every);
    const index = Math.floor(nowMs / unitMs);
    const startIndex = index - (index % safeEvery);
    const startMs = startIndex * unitMs;
    return {
        startMs,
        endMs: startMs + safeEvery * unitMs,
    };
}
function computeWeeklyWindow(now, everyWeeks) {
    const safeEvery = Math.max(1, everyWeeks);
    const startOfTodayMs = toUtcStartOfDay(now);
    const dayOfWeek = new Date(startOfTodayMs).getUTCDay();
    const isoOffset = (dayOfWeek + 6) % 7;
    const currentWeekStartMs = startOfTodayMs - isoOffset * DAY_MS;
    const weekIndex = Math.floor((currentWeekStartMs - ISO_WEEK_REFERENCE_MS) / WEEK_MS);
    const startWeekIndex = weekIndex - (weekIndex % safeEvery);
    const startMs = ISO_WEEK_REFERENCE_MS + startWeekIndex * WEEK_MS;
    return {
        startMs,
        endMs: startMs + safeEvery * WEEK_MS,
    };
}
function computeMonthlyWindow(now, everyMonths) {
    const safeEvery = Math.max(1, everyMonths);
    const monthIndex = (now.getUTCFullYear() - 1970) * 12 + now.getUTCMonth();
    const startMonthIndex = monthIndex - (monthIndex % safeEvery);
    const startYear = 1970 + Math.floor(startMonthIndex / 12);
    const startMonth = startMonthIndex % 12;
    const endMonthIndex = startMonthIndex + safeEvery;
    const endYear = 1970 + Math.floor(endMonthIndex / 12);
    const endMonth = endMonthIndex % 12;
    return {
        startMs: Date.UTC(startYear, startMonth, 1, 0, 0, 0, 0),
        endMs: Date.UTC(endYear, endMonth, 1, 0, 0, 0, 0),
    };
}
function describeResetPolicy(rule) {
    switch (rule.resetPolicy) {
        case 'hourly':
            return 'Resets hourly';
        case 'daily':
            return 'Resets daily';
        case 'weekly':
            return 'Resets weekly';
        case 'monthly':
            return 'Resets monthly';
        case 'custom': {
            const value = Math.max(1, asInt(rule.resetIntervalValue, 1) || 1);
            const unit = rule.resetIntervalUnit || 'day';
            return `Resets every ${value} ${unit}${value === 1 ? '' : 's'}`;
        }
        default:
            return 'No reset';
    }
}
function describePlanLimitMode(mode) {
    if (mode === 'current')
        return 'Current count';
    if (mode === 'per_request')
        return 'Per request';
    if (mode === 'concurrency')
        return 'Concurrency';
    return 'Usage-based';
}
function describePlanLimitResetLabel(rule) {
    switch (rule.resetPolicy) {
        case 'hourly':
            return 'Hourly';
        case 'daily':
            return 'Daily';
        case 'weekly':
            return 'Weekly';
        case 'monthly':
            return 'Monthly';
        case 'custom': {
            const value = Math.max(1, asInt(rule.resetIntervalValue, 1) || 1);
            const unit = rule.resetIntervalUnit || 'day';
            return `Every ${value} ${unit}${value === 1 ? '' : 's'}`;
        }
        default:
            return 'No reset';
    }
}
function formatPlanLimitCap(rule) {
    if (!rule.isEnabled)
        return 'Disabled';
    if (rule.isUnlimited)
        return 'Unlimited';
    return `${Math.max(0, Math.floor(Number(rule.value || 0))).toLocaleString()} ${String(rule.unitLabel || '').trim()}`.trim();
}
function describePlanLimitResetBehavior(rule) {
    if (rule.mode === 'per_request') {
        return 'Checked on every request. It does not use a scheduled reset window.';
    }
    if (rule.mode === 'concurrency') {
        return 'Checked against live concurrent work. It does not use a scheduled reset window.';
    }
    if (rule.mode === 'current') {
        return 'Checked against the current stored count. Capacity returns as items are removed.';
    }
    if (rule.resetPolicy === 'never') {
        return 'No scheduled reset. The cap only changes when usage drops or the rule is edited.';
    }
    return `${describeResetPolicy(rule)}.`;
}
function buildPlanLimitPresentation(rule) {
    const capLabel = formatPlanLimitCap(rule);
    const modeLabel = describePlanLimitMode(rule.mode);
    const resetLabel = describePlanLimitResetLabel(rule);
    return {
        capLabel,
        modeLabel,
        resetLabel,
        resetDescription: describePlanLimitResetBehavior(rule),
        summary: `${capLabel} / ${modeLabel} / ${resetLabel}`,
    };
}
function computeResetWindow(rule, now = new Date()) {
    if (rule.resetPolicy === 'never') {
        return {
            policy: 'never',
            intervalValue: null,
            intervalUnit: null,
            label: describeResetPolicy(rule),
            windowStart: EPOCH_START_ISO,
            windowEnd: null,
        };
    }
    let bounds;
    if (rule.resetPolicy === 'hourly') {
        bounds = computeAlignedWindow(toUtcStartOfHour(now), HOUR_MS, 1);
    }
    else if (rule.resetPolicy === 'daily') {
        bounds = computeAlignedWindow(toUtcStartOfDay(now), DAY_MS, 1);
    }
    else if (rule.resetPolicy === 'weekly') {
        bounds = computeWeeklyWindow(now, 1);
    }
    else if (rule.resetPolicy === 'monthly') {
        bounds = computeMonthlyWindow(now, 1);
    }
    else {
        const intervalValue = Math.max(1, asInt(rule.resetIntervalValue, 1) || 1);
        const intervalUnit = rule.resetIntervalUnit || 'day';
        if (intervalUnit === 'hour') {
            bounds = computeAlignedWindow(toUtcStartOfHour(now), HOUR_MS, intervalValue);
        }
        else if (intervalUnit === 'day') {
            bounds = computeAlignedWindow(toUtcStartOfDay(now), DAY_MS, intervalValue);
        }
        else if (intervalUnit === 'week') {
            bounds = computeWeeklyWindow(now, intervalValue);
        }
        else {
            bounds = computeMonthlyWindow(now, intervalValue);
        }
    }
    return {
        policy: rule.resetPolicy,
        intervalValue: rule.resetPolicy === 'custom' ? Math.max(1, asInt(rule.resetIntervalValue, 1) || 1) : null,
        intervalUnit: rule.resetPolicy === 'custom' ? (rule.resetIntervalUnit || 'day') : null,
        label: describeResetPolicy(rule),
        windowStart: new Date(bounds.startMs).toISOString(),
        windowEnd: new Date(bounds.endMs).toISOString(),
    };
}
function formatScopeLabel(scope) {
    if (scope === 'default')
        return 'Default';
    return scope.charAt(0).toUpperCase() + scope.slice(1);
}
