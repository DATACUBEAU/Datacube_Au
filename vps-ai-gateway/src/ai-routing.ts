import { SupabaseClient } from '@supabase/supabase-js';
import { errorLogDetails, firstEnv, logger } from './utils.js';

const aiGatewayContract = require('../../shared/ai-gateway-contract.cjs') as {
  defaultAnthropicModelForPlan(plan: unknown): string | null;
  defaultOpenRouterModelForPlan(plan: unknown): string;
  isPaidPlanCode(plan: unknown): boolean;
};

export type RoutingRequestType = 'chat' | 'global_chat' | 'knowledge' | 'prediction_engine' | 'exam_generator';

export type RoutingCandidate = {
  service: string;
  apiKey: string;
  model: string;
  errorCount: number;
  providerType: string;
};

const DEFAULT_PROVIDER_TYPE = 'openrouter';

function getActiveProviderKey(supabase: SupabaseClient, providerType: string): Promise<{ key: string; model: string } | null> {
  return new Promise((resolve) => {
    resolve({ key: firstEnv('OPENROUTER_API_KEY', 'OPENAI_API_KEY') || '', model: aiGatewayContract.defaultOpenRouterModelForPlan('free') });
  });
}

export async function selectProviderAndModel(input: {
  supabase: SupabaseClient;
  userId: string;
  plan: string | null | undefined;
  requestType: RoutingRequestType;
  requestedModel?: string | null;
}): Promise<RoutingCandidate> {
  const { supabase, plan, requestType } = input;
  
  let providerType = DEFAULT_PROVIDER_TYPE;
  
  if (requestType === 'knowledge' || requestType === 'prediction_engine' || requestType === 'exam_generator') {
    providerType = 'openrouter';
  }

  const providerKey = await getActiveProviderKey(supabase, providerType);
  
  if (!providerKey || !providerKey.key) {
    logger.warn('No active provider key found, using fallback');
    return {
      service: 'openrouter',
      apiKey: firstEnv('OPENROUTER_API_KEY', '') || '',
      model: aiGatewayContract.defaultOpenRouterModelForPlan(plan),
      errorCount: 0,
      providerType,
    };
  }

  return {
    service: providerType,
    apiKey: '[configured]',
    model: providerKey.model || aiGatewayContract.defaultOpenRouterModelForPlan(plan),
    errorCount: 0,
    providerType,
  };
}

export function buildRoutingCandidates(supabase: SupabaseClient, plan: string | null): RoutingCandidate[] {
  const isPaidPlan = aiGatewayContract.isPaidPlanCode(plan);
  const openRouterKey = firstEnv('OPENROUTER_API_KEY');
  const anthropicKey = firstEnv('ANTHROPIC_API_KEY');
  
  const candidates: RoutingCandidate[] = [];

  if (openRouterKey) {
    candidates.push({
      service: 'openrouter',
      apiKey: '[configured]',
      model: aiGatewayContract.defaultOpenRouterModelForPlan(plan),
      errorCount: 0,
      providerType: 'openrouter',
    });
  }

  const anthropicModel = aiGatewayContract.defaultAnthropicModelForPlan(plan);
  if (anthropicKey && isPaidPlan && anthropicModel) {
    candidates.push({
      service: 'anthropic',
      apiKey: '[configured]',
      model: anthropicModel,
      errorCount: 0,
      providerType: 'anthropic',
    });
  }

  return candidates;
}

export function noteRoutingFailure(candidate: RoutingCandidate, error: any) {
  logger.warn('Routing failure', { service: candidate.service, error: errorLogDetails(error) });
}

export function noteRoutingSuccess(candidate: RoutingCandidate) {
  logger.debug('Routing success', { service: candidate.service, model: candidate.model });
}
