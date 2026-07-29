export type AiGatewayRequestType =
  | 'chat'
  | 'global_chat'
  | 'knowledge'
  | 'prediction_engine'
  | 'exam_generator';

export type AiGatewayModelClass = 'paid_text';

export type AiGatewayOperation = {
  requestFeature: string;
  canonicalFeature: string;
  featureKey: string;
  gatewayRoute: string;
  usageFeature: string;
  requestType: AiGatewayRequestType;
  modelClass: AiGatewayModelClass;
};

export type GatewayRouteRequirement = {
  route: string;
  featureKey: string;
};

export {
  DEFAULT_ANTHROPIC_PAID_MODEL,
  DEFAULT_OPENROUTER_FREE_MODEL,
  DEFAULT_OPENROUTER_PAID_MODEL,
  FEATURE_ALIASES,
  OPERATION_DEFINITIONS,
  PAID_PLAN_CODES,
  defaultAnthropicModelForPlan,
  defaultOpenRouterModelForPlan,
  gatewayRouteRequirements,
  isHiddenOrInternalModelId,
  isPaidPlanCode,
  normalizeGatewayPath,
  normalizeToken,
  resolveAiGatewayOperation,
  routeRequirementForGatewayPath,
} from './ai-gateway-contract.cjs';
