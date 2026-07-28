import { SupabaseClient } from '@supabase/supabase-js';
import { errorLogDetails, firstEnv, logger } from './utils.js';

export type RoutingRequestType = 'chat' | 'global_chat' | 'knowledge' | 'prediction_engine' | 'exam_generator';

export type RoutingCandidate = {
  service: string;
  apiKey: string;
  model: string;
  errorCount: number;
  providerType: string;
};

const DEFAULT_PROVIDER_TYPE = 'openrouter';
const PAID_PLAN_CODES = new Set(['pro', 'premium', 'promo_pro', 'paid', 'weekly', 'monthly', 'admin']);

function isPaidPlanCode(plan: string | null | undefined): boolean {
  return PAID_PLAN_CODES.has(String(plan || '').trim().toLowerCase());
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? '');
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function getActiveProviderKey(supabase: SupabaseClient, providerType: string): Promise<{ key: string; model: string } | null> {
  return new Promise((resolve) => {
    resolve({ key: firstEnv('OPENROUTER_API_KEY', 'OPENAI_API_KEY') || '', model: 'meta-llama/llama-3.1-8b-instruct' });
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
  const isPaidPlan = isPaidPlanCode(plan);
  
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
      model: isPaidPlan ? 'meta-llama/llama-3.1-70b-instruct' : 'meta-llama/llama-3.1-8b-instruct',
      errorCount: 0,
      providerType,
    };
  }

  return {
    service: providerType,
    apiKey: '[configured]',
    model: providerKey.model || (isPaidPlan ? 'meta-llama/llama-3.1-70b-instruct' : 'meta-llama/llama-3.1-8b-instruct'),
    errorCount: 0,
    providerType,
  };
}

export function buildRoutingCandidates(supabase: SupabaseClient, plan: string | null): RoutingCandidate[] {
  const isPaidPlan = isPaidPlanCode(plan);
  const openRouterKey = firstEnv('OPENROUTER_API_KEY');
  const anthropicKey = firstEnv('ANTHROPIC_API_KEY');
  
  const candidates: RoutingCandidate[] = [];

  if (openRouterKey) {
    candidates.push({
      service: 'openrouter',
      apiKey: '[configured]',
      model: isPaidPlan ? 'meta-llama/llama-3.1-70b-instruct' : 'meta-llama/llama-3.1-8b-instruct',
      errorCount: 0,
      providerType: 'openrouter',
    });
  }

  if (anthropicKey && isPaidPlan) {
    candidates.push({
      service: 'anthropic',
      apiKey: '[configured]',
      model: 'claude-3-haiku-20240307',
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
