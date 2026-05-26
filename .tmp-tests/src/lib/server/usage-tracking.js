"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUploadUsageIncrements = exports.buildFeatureUsageIncrements = exports.buildChatUsageIncrements = exports.USAGE_METRIC_ALIASES = exports.TRACKED_USAGE_METRIC_KEYS = void 0;
exports.buildUsageEventKey = buildUsageEventKey;
exports.buildChatTrackingPayload = buildChatTrackingPayload;
exports.trackUsageEvent = trackUsageEvent;
exports.loadUsageMetricDefinitions = loadUsageMetricDefinitions;
exports.loadUsageCounterSnapshots = loadUsageCounterSnapshots;
exports.loadTrackedUsageWindowTotals = loadTrackedUsageWindowTotals;
exports.resolveTrackedMetricValue = resolveTrackedMetricValue;
exports.resolveUsageMetricForRule = resolveUsageMetricForRule;
exports.buildUsageHealthReport = buildUsageHealthReport;
const plan_limit_model_1 = require("../limits/plan-limit-model");
const usage_metrics_1 = require("../../../shared/usage-metrics");
Object.defineProperty(exports, "TRACKED_USAGE_METRIC_KEYS", { enumerable: true, get: function () { return usage_metrics_1.TRACKED_USAGE_METRIC_KEYS; } });
Object.defineProperty(exports, "USAGE_METRIC_ALIASES", { enumerable: true, get: function () { return usage_metrics_1.USAGE_METRIC_ALIASES; } });
Object.defineProperty(exports, "buildChatUsageIncrements", { enumerable: true, get: function () { return usage_metrics_1.buildChatUsageIncrements; } });
Object.defineProperty(exports, "buildFeatureUsageIncrements", { enumerable: true, get: function () { return usage_metrics_1.buildFeatureUsageIncrements; } });
Object.defineProperty(exports, "buildUploadUsageIncrements", { enumerable: true, get: function () { return usage_metrics_1.buildUploadUsageIncrements; } });
function isSchemaDriftError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return (code === '42P01' ||
        code === '42703' ||
        code === '42883' ||
        code.startsWith('PGRST') ||
        message.includes('does not exist') ||
        details.includes('does not exist'));
}
function shouldUseTrackedCountersForRuleMode(mode) {
    return String(mode || '').trim().toLowerCase() === 'usage';
}
function buildUsageEventKey(input) {
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (idempotencyKey)
        return `${input.feature}:idempotency:${idempotencyKey}`;
    const requestId = String(input.requestId || '').trim();
    if (requestId)
        return `${input.feature}:request:${requestId}`;
    const correlationId = String(input.correlationId || '').trim();
    if (correlationId)
        return `${input.feature}:correlation:${correlationId}`;
    const fallbackSeed = String(input.fallbackSeed || '').trim();
    if (fallbackSeed)
        return `${input.feature}:fallback:${fallbackSeed}`;
    return `${input.feature}:anonymous`;
}
function buildChatTrackingPayload(input) {
    const estimatedTokens = (0, usage_metrics_1.estimateChatRequestTokens)(input);
    return {
        estimatedTokens,
        increments: (0, usage_metrics_1.buildChatUsageIncrements)(estimatedTokens),
    };
}
async function trackUsageEvent(input) {
    const normalized = (0, usage_metrics_1.normalizeMetricIncrements)(input.increments);
    if (!input.userId || !input.feature || !input.eventKey || Object.keys(normalized).length === 0) {
        return {
            tracked: false,
            deduped: false,
            eventId: null,
            eventKey: input.eventKey,
            snapshot: {},
        };
    }
    const { data, error } = await input.supabase.rpc('track_usage_event', {
        p_user_id: input.userId,
        p_event_key: input.eventKey,
        p_feature: input.feature,
        p_source: input.source,
        p_metrics: normalized,
        p_request_id: input.requestId || null,
        p_correlation_id: input.correlationId || null,
        p_context: input.context || {},
    });
    if (error) {
        if (isSchemaDriftError(error)) {
            return {
                tracked: false,
                deduped: false,
                eventId: null,
                eventKey: input.eventKey,
                snapshot: {},
            };
        }
        throw error;
    }
    const payload = (data || {});
    return {
        tracked: payload.ok !== false,
        deduped: payload.deduped === true,
        eventId: typeof payload.event_id === 'string' ? payload.event_id : null,
        eventKey: typeof payload.event_key === 'string' ? payload.event_key : input.eventKey,
        snapshot: (payload.snapshot || {}),
    };
}
async function loadUsageMetricDefinitions(supabase) {
    const { data, error } = await supabase
        .from('au_usage_metric_definitions')
        .select('metric_key,label,unit,category,limit_key,reset_policy,reset_interval_value,reset_interval_unit,is_enabled,is_integer,min_value,max_value,description')
        .eq('is_enabled', true)
        .order('metric_key', { ascending: true });
    if (error) {
        if (isSchemaDriftError(error))
            return [];
        throw error;
    }
    return (data || []);
}
async function loadUsageCounterSnapshots(supabase, userId) {
    const [todayRes, totalRes] = await Promise.all([
        supabase.from('usage_counters').select('counters').eq('user_id', userId).eq('day', new Date().toISOString().slice(0, 10)).maybeSingle(),
        supabase.from('usage_totals').select('counters').eq('user_id', userId).maybeSingle(),
    ]);
    const today = !todayRes.error && todayRes.data ? (todayRes.data.counters || {}) : {};
    const total = !totalRes.error && totalRes.data ? (totalRes.data.counters || {}) : {};
    return { today, total };
}
async function loadTrackedUsageWindowTotals(input) {
    const keys = Array.from(new Set(input.metricKeys.map((entry) => String(entry || '').trim()).filter(Boolean)));
    if (!input.userId || keys.length === 0)
        return {};
    const { data, error } = await input.supabase.rpc('get_usage_metric_window_totals', {
        p_user_id: input.userId,
        p_metric_keys: keys,
        p_window_start: input.windowStart,
        p_window_end: input.windowEnd,
    });
    if (error) {
        if (isSchemaDriftError(error))
            return {};
        throw error;
    }
    return Object.entries((data || {})).reduce((acc, [key, raw]) => {
        const parsed = Number(raw);
        if (Number.isFinite(parsed))
            acc[key] = parsed;
        return acc;
    }, {});
}
function resolveTrackedMetricValue(source, metricKey) {
    return (0, usage_metrics_1.readUsageMetricValue)(source, usage_metrics_1.USAGE_METRIC_ALIASES[metricKey] || [metricKey], 0);
}
async function resolveUsageMetricForRule(input) {
    if (!shouldUseTrackedCountersForRuleMode(input.rule.mode)) {
        return {
            trackedUsed: 0,
            effectiveUsed: Math.max(0, input.fallbackUsed),
            source: 'limit_snapshot',
        };
    }
    const aliases = usage_metrics_1.USAGE_METRIC_ALIASES[input.metricKey] || [input.metricKey];
    const window = (0, plan_limit_model_1.computeResetWindow)(input.rule);
    let trackedUsed = 0;
    const usingLifetimeWindow = !window.windowEnd && window.windowStart.startsWith('1970-01-01T00:00:00');
    const usingCurrentDayWindow = window.policy === 'daily' &&
        window.windowStart === `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    if (usingLifetimeWindow) {
        trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(input.totalCounters || {}, aliases, 0);
    }
    else if (usingCurrentDayWindow) {
        trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(input.todayCounters || {}, aliases, 0);
    }
    else {
        const totals = await loadTrackedUsageWindowTotals({
            supabase: input.supabase,
            userId: input.userId,
            metricKeys: aliases,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
        });
        trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(totals, aliases, 0);
    }
    if (trackedUsed <= 0 && input.fallbackUsed <= 0) {
        return { trackedUsed: 0, effectiveUsed: 0, source: 'tracked' };
    }
    if (trackedUsed > 0 && input.fallbackUsed > 0 && trackedUsed !== input.fallbackUsed) {
        return {
            trackedUsed,
            effectiveUsed: Math.max(trackedUsed, input.fallbackUsed),
            source: 'hybrid',
        };
    }
    if (trackedUsed > 0) {
        return { trackedUsed, effectiveUsed: trackedUsed, source: 'tracked' };
    }
    return {
        trackedUsed: 0,
        effectiveUsed: Math.max(0, input.fallbackUsed),
        source: 'legacy',
    };
}
async function buildUsageHealthReport(input) {
    const { today, total } = await loadUsageCounterSnapshots(input.supabase, input.userId);
    const rows = await Promise.all(input.definitions.map(async (definition) => {
        const aliases = usage_metrics_1.USAGE_METRIC_ALIASES[definition.metric_key] || [definition.metric_key];
        const limitKey = definition.limit_key || null;
        const limit = limitKey && Number.isFinite(Number(input.effectiveLimits[limitKey]))
            ? Number(input.effectiveLimits[limitKey])
            : null;
        const legacyEntry = limitKey ? (input.usageByLimit[limitKey] || {}) : {};
        const legacyUsed = limitKey ? Number(legacyEntry.used || 0) || 0 : (0, usage_metrics_1.readUsageMetricValue)(total, aliases, 0);
        const limitMode = limitKey ? String(legacyEntry?.mode || '').trim().toLowerCase() : '';
        const useTrackedForLimit = !limitKey || shouldUseTrackedCountersForRuleMode(limitMode);
        let trackedUsed = 0;
        let resetWindowStart = null;
        let resetWindowEnd = null;
        const todayWindowStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
        if (limitKey && input.usageByLimit[limitKey]?.reset) {
            resetWindowStart = String(input.usageByLimit[limitKey]?.reset?.window_start || '') || null;
            resetWindowEnd = String(input.usageByLimit[limitKey]?.reset?.window_end || '') || null;
            if (useTrackedForLimit && resetWindowStart === todayWindowStart) {
                trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(today, aliases, 0);
            }
            else if (useTrackedForLimit &&
                !resetWindowEnd &&
                resetWindowStart &&
                resetWindowStart.startsWith('1970-01-01T00:00:00')) {
                trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(total, aliases, 0);
            }
        }
        else if (definition.reset_policy === 'daily') {
            trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(today, aliases, 0);
            resetWindowStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
            resetWindowEnd = null;
        }
        else if (definition.reset_policy === 'never') {
            trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(total, aliases, 0);
            resetWindowStart = '1970-01-01T00:00:00.000Z';
            resetWindowEnd = null;
        }
        else {
            const now = new Date();
            const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
            const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
            resetWindowStart = monthStart.toISOString();
            resetWindowEnd = monthEnd.toISOString();
        }
        if (useTrackedForLimit && trackedUsed === 0 && resetWindowStart) {
            const totals = await loadTrackedUsageWindowTotals({
                supabase: input.supabase,
                userId: input.userId,
                metricKeys: aliases,
                windowStart: resetWindowStart,
                windowEnd: resetWindowEnd,
            });
            trackedUsed = (0, usage_metrics_1.readUsageMetricValue)(totals, aliases, trackedUsed);
        }
        let source = useTrackedForLimit ? 'tracked' : 'limit_snapshot';
        let effectiveUsed = useTrackedForLimit ? trackedUsed : legacyUsed;
        if (!useTrackedForLimit) {
            trackedUsed = 0;
        }
        else if (trackedUsed > 0 && legacyUsed > 0 && trackedUsed !== legacyUsed) {
            source = 'hybrid';
            effectiveUsed = Math.max(trackedUsed, legacyUsed);
        }
        else if (trackedUsed <= 0 && legacyUsed > 0) {
            source = 'legacy';
            effectiveUsed = legacyUsed;
        }
        return {
            metricKey: definition.metric_key,
            label: definition.label,
            unit: definition.unit,
            category: definition.category,
            limitKey,
            limit,
            trackedUsed,
            legacyUsed,
            effectiveUsed,
            source,
            resetPolicy: definition.reset_policy,
            resetWindowStart,
            resetWindowEnd,
            withinLimit: limit === null ? true : effectiveUsed <= limit,
        };
    }));
    return rows.sort((a, b) => a.metricKey.localeCompare(b.metricKey));
}
