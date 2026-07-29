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

export const DEFAULT_OPENROUTER_FREE_MODEL: string;
export const DEFAULT_OPENROUTER_PAID_MODEL: string;
export const DEFAULT_ANTHROPIC_PAID_MODEL: string;
export const OPERATION_DEFINITIONS: Record<string, Omit<AiGatewayOperation, 'requestFeature' | 'canonicalFeature'>>;
export const FEATURE_ALIASES: Record<string, string>;
export const PAID_PLAN_CODES: readonly string[];
export function normalizeToken(value: unknown): string;
export function normalizeGatewayPath(rawUrl: string): string;
export function resolveAiGatewayOperation(value: unknown): AiGatewayOperation | null;
export function gatewayRouteRequirements(): Record<string, GatewayRouteRequirement>;
export function routeRequirementForGatewayPath(rawUrl: string): GatewayRouteRequirement | null;
export function isPaidPlanCode(plan: unknown): boolean;
export function defaultOpenRouterModelForPlan(plan: unknown): string;
export function defaultAnthropicModelForPlan(plan: unknown): string | null;
export function isHiddenOrInternalModelId(model: unknown): boolean;
