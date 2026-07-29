'use strict';

const DEFAULT_OPENROUTER_FREE_MODEL = 'meta-llama/llama-3.1-8b-instruct';
const DEFAULT_OPENROUTER_PAID_MODEL = 'meta-llama/llama-3.1-70b-instruct';
const DEFAULT_ANTHROPIC_PAID_MODEL = 'claude-3-haiku-20240307';

const OPERATION_DEFINITIONS = Object.freeze({
  chat: {
    featureKey: 'au_chat',
    gatewayRoute: '/chat/au-chat',
    usageFeature: 'au-chat',
    requestType: 'chat',
    modelClass: 'paid_text',
  },
  'global-chat': {
    featureKey: 'global_chat',
    gatewayRoute: '/chat/global-chat',
    usageFeature: 'global-chat',
    requestType: 'global_chat',
    modelClass: 'paid_text',
  },
  'generate-knowledge': {
    featureKey: 'knowledge_generation',
    gatewayRoute: '/generate/knowledge',
    usageFeature: 'generate-knowledge',
    requestType: 'knowledge',
    modelClass: 'paid_text',
  },
  'generate-practice-exam': {
    featureKey: 'practice_exam_generation',
    gatewayRoute: '/generate/practice-exam',
    usageFeature: 'generate-practice-exam',
    requestType: 'exam_generator',
    modelClass: 'paid_text',
  },
  'generate-exam-predictions': {
    featureKey: 'exam_predictions',
    gatewayRoute: '/generate/exam-predictions',
    usageFeature: 'generate-exam-predictions',
    requestType: 'prediction_engine',
    modelClass: 'paid_text',
  },
  'generate-prompt-starters': {
    featureKey: 'prompt_starters',
    gatewayRoute: '/generate/prompt-starters',
    usageFeature: 'generate-prompt-starters',
    requestType: 'chat',
    modelClass: 'paid_text',
  },
});

const FEATURE_ALIASES = Object.freeze({
  chat: 'chat',
  'au-chat': 'chat',
  au_chat: 'chat',
  'global-chat': 'global-chat',
  global_chat: 'global-chat',
  'generate-knowledge': 'generate-knowledge',
  knowledge: 'generate-knowledge',
  knowledge_hub: 'generate-knowledge',
  knowledge_generation: 'generate-knowledge',
  'exam-generator': 'generate-practice-exam',
  'generate-practice-exam': 'generate-practice-exam',
  practice: 'generate-practice-exam',
  practice_exam_generation: 'generate-practice-exam',
  'prediction-engine': 'generate-exam-predictions',
  'generate-exam-predictions': 'generate-exam-predictions',
  exam_prediction: 'generate-exam-predictions',
  exam_predictions: 'generate-exam-predictions',
  'generate-prompt-starters': 'generate-prompt-starters',
  prompt_starters: 'generate-prompt-starters',
});

const LEGACY_ROUTE_REQUIREMENTS = Object.freeze({
  '/chat/legacy': { route: '/chat/legacy', featureKey: 'au_chat' },
});

const PAID_PLAN_CODES = Object.freeze(['pro', 'premium', 'promo_pro', 'paid', 'weekly', 'monthly', 'admin']);

function normalizeToken(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizeGatewayPath(rawUrl) {
  const raw = String(rawUrl || '').trim() || '/';
  const withoutQuery = raw.split('?')[0] || '/';
  return withoutQuery.endsWith('/') && withoutQuery !== '/'
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

function resolveAiGatewayOperation(value) {
  const requestFeature = normalizeToken(value || 'chat');
  const canonicalFeature = FEATURE_ALIASES[requestFeature];
  if (!canonicalFeature) return null;
  const definition = OPERATION_DEFINITIONS[canonicalFeature];
  if (!definition) return null;
  return Object.freeze({
    requestFeature,
    canonicalFeature,
    featureKey: definition.featureKey,
    gatewayRoute: definition.gatewayRoute,
    usageFeature: definition.usageFeature,
    requestType: definition.requestType,
    modelClass: definition.modelClass,
  });
}

function gatewayRouteRequirements() {
  const requirements = {};
  for (const definition of Object.values(OPERATION_DEFINITIONS)) {
    requirements[definition.gatewayRoute] = {
      route: definition.gatewayRoute,
      featureKey: definition.featureKey,
    };
  }
  return Object.freeze({ ...requirements, ...LEGACY_ROUTE_REQUIREMENTS });
}

function routeRequirementForGatewayPath(rawUrl) {
  const route = normalizeGatewayPath(rawUrl);
  return gatewayRouteRequirements()[route] || null;
}

function isPaidPlanCode(plan) {
  return PAID_PLAN_CODES.includes(normalizeToken(plan));
}

function defaultOpenRouterModelForPlan(plan) {
  return isPaidPlanCode(plan) ? DEFAULT_OPENROUTER_PAID_MODEL : DEFAULT_OPENROUTER_FREE_MODEL;
}

function defaultAnthropicModelForPlan(plan) {
  return isPaidPlanCode(plan) ? DEFAULT_ANTHROPIC_PAID_MODEL : null;
}

function isHiddenOrInternalModelId(model) {
  const normalized = normalizeToken(model);
  return (
    !normalized ||
    normalized.startsWith('internal/') ||
    normalized.startsWith('hidden/') ||
    normalized.includes(':internal') ||
    normalized.includes(':hidden')
  );
}

module.exports = Object.freeze({
  DEFAULT_OPENROUTER_FREE_MODEL,
  DEFAULT_OPENROUTER_PAID_MODEL,
  DEFAULT_ANTHROPIC_PAID_MODEL,
  OPERATION_DEFINITIONS,
  FEATURE_ALIASES,
  PAID_PLAN_CODES,
  normalizeToken,
  normalizeGatewayPath,
  resolveAiGatewayOperation,
  gatewayRouteRequirements,
  routeRequirementForGatewayPath,
  isPaidPlanCode,
  defaultOpenRouterModelForPlan,
  defaultAnthropicModelForPlan,
  isHiddenOrInternalModelId,
});
