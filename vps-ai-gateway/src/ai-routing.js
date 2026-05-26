"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectProviderAndModel = selectProviderAndModel;
exports.buildRoutingCandidates = buildRoutingCandidates;
exports.noteRoutingFailure = noteRoutingFailure;
exports.noteRoutingSuccess = noteRoutingSuccess;
const utils_js_1 = require("./utils.js");
const DEFAULT_PROVIDER_TYPE = 'openrouter';
const PAID_PLAN_CODES = new Set(['pro', 'premium', 'promo_pro', 'paid', 'weekly', 'monthly', 'admin']);
function isPaidPlanCode(plan) {
    return PAID_PLAN_CODES.has(String(plan || '').trim().toLowerCase());
}
function parsePositiveInt(raw, fallback) {
    const parsed = Number(raw ?? '');
    if (!Number.isFinite(parsed) || parsed < 0)
        return fallback;
    return Math.floor(parsed);
}
function getActiveProviderKey(supabase, providerType) {
    return new Promise((resolve) => {
        resolve({ key: (0, utils_js_1.firstEnv)('OPENROUTER_API_KEY', 'OPENAI_API_KEY') || '', model: 'meta-llama/llama-3.1-8b-instruct' });
    });
}
async function selectProviderAndModel(input) {
    const { supabase, plan, requestType } = input;
    const isPaidPlan = isPaidPlanCode(plan);
    let providerType = DEFAULT_PROVIDER_TYPE;
    if (requestType === 'knowledge' || requestType === 'prediction_engine' || requestType === 'exam_generator') {
        providerType = 'openrouter';
    }
    const providerKey = await getActiveProviderKey(supabase, providerType);
    if (!providerKey || !providerKey.key) {
        utils_js_1.logger.warn('No active provider key found, using fallback');
        return {
            service: 'openrouter',
            apiKey: (0, utils_js_1.firstEnv)('OPENROUTER_API_KEY', '') || '',
            model: isPaidPlan ? 'meta-llama/llama-3.1-70b-instruct' : 'meta-llama/llama-3.1-8b-instruct',
            errorCount: 0,
            providerType,
        };
    }
    return {
        service: providerType,
        apiKey: providerKey.key,
        model: providerKey.model || (isPaidPlan ? 'meta-llama/llama-3.1-70b-instruct' : 'meta-llama/llama-3.1-8b-instruct'),
        errorCount: 0,
        providerType,
    };
}
function buildRoutingCandidates(supabase, plan) {
    const isPaidPlan = isPaidPlanCode(plan);
    const openRouterKey = (0, utils_js_1.firstEnv)('OPENROUTER_API_KEY');
    const anthropicKey = (0, utils_js_1.firstEnv)('ANTHROPIC_API_KEY');
    const candidates = [];
    if (openRouterKey) {
        candidates.push({
            service: 'openrouter',
            apiKey: openRouterKey,
            model: isPaidPlan ? 'meta-llama/llama-3.1-70b-instruct' : 'meta-llama/llama-3.1-8b-instruct',
            errorCount: 0,
            providerType: 'openrouter',
        });
    }
    if (anthropicKey && isPaidPlan) {
        candidates.push({
            service: 'anthropic',
            apiKey: anthropicKey,
            model: 'claude-3-haiku-20240307',
            errorCount: 0,
            providerType: 'anthropic',
        });
    }
    return candidates;
}
function noteRoutingFailure(candidate, error) {
    utils_js_1.logger.warn('Routing failure', { service: candidate.service, error: error.message });
}
function noteRoutingSuccess(candidate) {
    utils_js_1.logger.debug('Routing success', { service: candidate.service, model: candidate.model });
}
