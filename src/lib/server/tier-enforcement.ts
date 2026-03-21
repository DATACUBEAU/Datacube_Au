import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCanonicalEffectiveLimits } from '@/lib/server/au-limits';
import {
  TIER_TUNING_POLICY,
  featureUpgradeHref,
  getFeaturePolicy,
  getQuotaPolicy,
  isFeatureAllowedForTier,
  isProLikeTier,
  limitUpgradeHref,
  toTierRuntime,
  type TierFeatureKey,
  type TierId,
  type TierQuotaKey,
  type TierRuntime,
} from '@/lib/tier/policy';

type QuotaConsumeResponse = {
  allowed?: boolean;
  key?: string;
  count?: number;
  limit?: number | null;
  period_end?: string | null;
};

export type TierContext = {
  tier: TierId;
  runtimeTier: TierRuntime;
  planForRouting: 'free' | 'pro';
  entitlementSource: 'paid' | 'promo' | 'none';
  expiresAt: string | null;
};

export type ProxyTierGuardInput = {
  supabase?: SupabaseClient | null;
  userId: string;
  functionName: string;
  method: string;
  body: any;
  requestPath: string;
};

export type ProxyTierGuardResult = {
  tierContext: TierContext;
  body: any;
  appliedGuards: string[];
};

export class TierAccessError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload?.message || payload?.error || 'tier_access_denied'));
    this.status = status;
    this.payload = payload;
  }
}

function normalizeFunctionName(functionName: string): string {
  return String(functionName || '').trim().toLowerCase();
}

function normalizeMethod(method: string): string {
  return String(method || 'GET').trim().toUpperCase();
}

function quotaTierForRpc(tier: TierRuntime): 'free' | 'pro' {
  // Some DB functions only support free/pro tiers. Promo Pro should behave like Pro.
  return tier === 'free' ? 'free' : 'pro';
}

function defaultTierContext(): TierContext {
  return {
    tier: 'FREE',
    runtimeTier: 'free',
    planForRouting: 'free',
    entitlementSource: 'none',
    expiresAt: null,
  };
}

function isUndefinedFunctionError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    (message.includes('function') && message.includes('does not exist')) ||
    (message.includes('schema cache') && message.includes('function')) ||
    (details.includes('schema cache') && details.includes('function'))
  );
}

function isUndefinedColumnError(error: any): boolean {
  const code = String(error?.code || '').trim();
  return code === '42703';
}

function limitMessage(limitKey: TierQuotaKey): string {
  const map: Record<TierQuotaKey, string> = {
    messages_per_day: 'You reached your daily message limit for your current plan.',
    chat_requests_per_minute: 'Too many chat requests in a short period. Retry shortly.',
    knowledge_generations_per_day: 'You reached your daily knowledge generation limit.',
    prompt_starters_per_day: 'You reached your daily prompt starter limit.',
    practice_exams_per_day: 'You reached your daily practice exam generation limit.',
    predictions_per_day: 'You reached your daily prediction generation limit.',
    max_documents_uploaded_total: 'You reached your lifetime document upload limit for your plan.',
  };
  return map[limitKey] || 'Plan limit reached.';
}

function buildProRequiredPayload(featureKey: TierFeatureKey): Record<string, unknown> {
  const feature = getFeaturePolicy(featureKey);
  const key = featureKey;
  return {
    error: 'PRO_REQUIRED',
    key,
    message: feature
      ? `${feature.title} is available on Pro. Upgrade to continue.`
      : 'This feature requires Pro.',
    upgrade: {
      cta: 'Upgrade to Pro',
      href: featureUpgradeHref(featureKey),
    },
  };
}

function buildLimitReachedPayload(params: {
  key: string;
  message: string;
  count?: number;
  limit?: number | null;
  resetAt?: string | null;
}): Record<string, unknown> {
  return {
    error: 'LIMIT_REACHED',
    key: params.key,
    message: params.message,
    used: typeof params.count === 'number' ? params.count : undefined,
    limit: typeof params.limit === 'number' ? params.limit : undefined,
    reset_at: params.resetAt || null,
    upgrade: {
      cta: 'Upgrade to Pro',
      href: limitUpgradeHref(params.key),
    },
  };
}

async function logLimitEvent(input: {
  supabase: SupabaseClient;
  userId: string;
  key: string;
  route: string;
  tier: TierRuntime;
  metadata?: Record<string, unknown>;
}) {
  try {
    await input.supabase.from('limit_events').insert({
      user_id: input.userId,
      key: input.key,
      route: input.route,
      tier: input.tier,
      metadata: input.metadata || {},
      created_at: new Date().toISOString(),
    });
  } catch {
    // best effort telemetry
  }
}

async function consumeQuotaOrThrow(input: {
  supabase: SupabaseClient;
  userId: string;
  tierContext: TierContext;
  quotaKey: TierQuotaKey;
  route: string;
  increment?: number;
  metadata?: Record<string, unknown>;
}) {
  const increment = Number.isFinite(Number(input.increment)) ? Number(input.increment) : 1;
  if (increment <= 0) return;

  const quota = getQuotaPolicy(input.quotaKey);
  if (!quota) return;

  let data: QuotaConsumeResponse | null = null;
  try {
    const rpcResult = await input.supabase.rpc('consume_quota_counter', {
      p_user_id: input.userId,
      p_key: input.quotaKey,
      p_tier: quotaTierForRpc(input.tierContext.runtimeTier),
      p_increment: increment,
    });
    if (rpcResult.error) throw rpcResult.error;
    data = (rpcResult.data || null) as QuotaConsumeResponse | null;
  } catch (error: any) {
    if (isUndefinedFunctionError(error)) {
      // Safety fallback for environments not migrated yet: skip new quota enforcement.
      console.warn('[tier-access] Missing quota RPC, skipping consume_quota_counter.', {
        code: error?.code || null,
        message: error?.message || null,
      });
      return;
    }
    throw error;
  }

  if (data?.allowed !== false) return;

  await logLimitEvent({
    supabase: input.supabase,
    userId: input.userId,
    key: input.quotaKey,
    route: input.route,
    tier: input.tierContext.runtimeTier,
    metadata: {
      count: data?.count ?? null,
      limit: data?.limit ?? null,
      period_end: data?.period_end ?? null,
      ...input.metadata,
    },
  });

  throw new TierAccessError(
    429,
    buildLimitReachedPayload({
      key: input.quotaKey,
      message: limitMessage(input.quotaKey),
      count: typeof data?.count === 'number' ? data.count : undefined,
      limit: typeof data?.limit === 'number' ? data.limit : null,
      resetAt: typeof data?.period_end === 'string' ? data.period_end : null,
    })
  );
}

function clampChatPayloadByTier(tierContext: TierContext, body: any): any {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const isPro = isProLikeTier(tierContext.tier);
  const retrievalCap = isPro ? TIER_TUNING_POLICY.retrievalTopK.pro : TIER_TUNING_POLICY.retrievalTopK.free;
  const memoryCap = isPro ? TIER_TUNING_POLICY.memoryTurnWindow.pro : TIER_TUNING_POLICY.memoryTurnWindow.free;
  const next = { ...body } as Record<string, any>;

  if (next.retrieval && typeof next.retrieval === 'object') {
    const rawTopK = Number((next.retrieval as any).top_k);
    if (Number.isFinite(rawTopK) && rawTopK > retrievalCap) {
      next.retrieval = {
        ...next.retrieval,
        top_k: retrievalCap,
      };
    }
  }

  if (next.recent_snippet && typeof next.recent_snippet === 'object' && Array.isArray((next.recent_snippet as any).turns)) {
    const turns = (next.recent_snippet as any).turns as any[];
    if (turns.length > memoryCap) {
      next.recent_snippet = {
        ...next.recent_snippet,
        turns: turns.slice(-memoryCap),
      };
    }
  }

  if (next.secondary_snippet && typeof next.secondary_snippet === 'object' && Array.isArray((next.secondary_snippet as any).turns)) {
    const turns = (next.secondary_snippet as any).turns as any[];
    if (turns.length > memoryCap) {
      next.secondary_snippet = {
        ...next.secondary_snippet,
        turns: turns.slice(-memoryCap),
      };
    }
  }

  return next;
}

function resolveFeatureFromFunction(functionName: string): TierFeatureKey | null {
  const normalized = normalizeFunctionName(functionName);
  if (normalized === 'chat' || normalized === 'au-chat') return 'au_chat';
  if (normalized === 'global-chat') return 'global_chat';
  if (normalized === 'generate-knowledge') return 'knowledge_generation';
  if (normalized === 'exam-generator' || normalized === 'generate-practice-exam') return 'practice_exam_generation';
  if (normalized === 'prediction-engine' || normalized === 'generate-exam-predictions') return 'exam_predictions';
  if (normalized === 'generate-prompt-starters') return 'prompt_starters';
  if (normalized === 'document-upload') return 'document_upload';
  return null;
}

export function isTierGuardedFunction(functionName: string): boolean {
  return resolveFeatureFromFunction(functionName) !== null;
}

export function requireTier(
  tierContext: TierContext,
  featureKey: TierFeatureKey,
  allowedTiers: TierId[]
) {
  if (allowedTiers.includes(tierContext.tier)) return;
  throw new TierAccessError(402, buildProRequiredPayload(featureKey));
}

export function enforceFeature(
  tierContext: TierContext,
  featureKey: TierFeatureKey
) {
  const feature = getFeaturePolicy(featureKey);
  const allowedTiers = feature?.allowedTiers || ['PRO', 'PROMO_PRO'];
  requireTier(tierContext, featureKey, allowedTiers);
}

export async function enforceQuota(input: {
  supabase: SupabaseClient;
  userId: string;
  tierContext: TierContext;
  quotaKey: TierQuotaKey;
  route: string;
  increment?: number;
  metadata?: Record<string, unknown>;
}) {
  await consumeQuotaOrThrow(input);
}

export function enforceModelAccess(input: {
  tierContext: TierContext;
  model: string;
}) {
  const model = String(input.model || '').trim().toLowerCase();
  if (!model) {
    throw new TierAccessError(400, {
      error: 'model_not_allowed',
      key: 'premium_models',
      message: 'model_not_allowed',
    });
  }
}

export async function resolveUserTierContext(
  supabase: SupabaseClient,
  userId: string
): Promise<TierContext> {
  const resolved = await resolveCanonicalEffectiveLimits({
    supabase,
    userId,
  });
  const tier: TierId = resolved.effectivePlan.hasPro
    ? (resolved.effectivePlan.entitlementSource === 'promo' ? 'PROMO_PRO' : 'PRO')
    : 'FREE';

  return {
    tier,
    runtimeTier: toTierRuntime(tier),
    planForRouting: isProLikeTier(tier) ? 'pro' : 'free',
    entitlementSource: resolved.effectivePlan.entitlementSource,
    expiresAt: resolved.effectivePlan.expiresAt,
  };
}

function shouldSkipQuotaForBody(functionName: string, body: any): boolean {
  const normalized = normalizeFunctionName(functionName);
  if ((normalized === 'chat' || normalized === 'au-chat') && String(body?.action || '').toLowerCase() === 'get_models') {
    return true;
  }
  return false;
}

function shouldBypassLegacyFeatureGate(featureKey: TierFeatureKey): boolean {
  return (
    featureKey === 'knowledge_generation' ||
    featureKey === 'practice_exam_generation' ||
    featureKey === 'exam_predictions' ||
    featureKey === 'document_upload'
  );
}

function shouldBypassLegacyQuota(featureKey: TierFeatureKey): boolean {
  return (
    featureKey === 'au_chat' ||
    featureKey === 'global_chat' ||
    featureKey === 'knowledge_generation' ||
    featureKey === 'practice_exam_generation' ||
    featureKey === 'exam_predictions' ||
    featureKey === 'document_upload'
  );
}

export async function enforceProxyTierAccess(input: ProxyTierGuardInput): Promise<ProxyTierGuardResult> {
  const { supabase, userId, functionName, requestPath } = input;
  const method = normalizeMethod(input.method);
  const featureKey = resolveFeatureFromFunction(functionName);
  const appliedGuards: string[] = [];

  let body = input.body;
  const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';

  if (!featureKey) {
    return { tierContext: defaultTierContext(), body, appliedGuards };
  }

  if (!supabase) {
    throw new Error('Tier enforcement requires an admin Supabase client for guarded functions.');
  }

  const tierContext = await resolveUserTierContext(supabase, userId);

  if (!shouldBypassLegacyFeatureGate(featureKey) && !isFeatureAllowedForTier(featureKey, tierContext.tier)) {
    await logLimitEvent({
      supabase,
      userId,
      key: featureKey,
      route: requestPath,
      tier: tierContext.runtimeTier,
      metadata: { reason: 'pro_required' },
    });
    enforceFeature(tierContext, featureKey);
  }
  appliedGuards.push(`feature:${featureKey}`);

  if (isWrite) {
    if (featureKey === 'au_chat' || featureKey === 'global_chat') {
      if (!shouldBypassLegacyQuota(featureKey) && !shouldSkipQuotaForBody(functionName, body)) {
        await consumeQuotaOrThrow({
          supabase,
          userId,
          tierContext,
          quotaKey: 'chat_requests_per_minute',
          route: requestPath,
          increment: 1,
        });
        await consumeQuotaOrThrow({
          supabase,
          userId,
          tierContext,
          quotaKey: 'messages_per_day',
          route: requestPath,
          increment: 1,
        });
        appliedGuards.push('quota:chat_requests_per_minute');
        appliedGuards.push('quota:messages_per_day');
      }
      body = clampChatPayloadByTier(tierContext, body);
      appliedGuards.push('clamp:chat_payload');
    }

    if (featureKey === 'knowledge_generation' && !shouldBypassLegacyQuota(featureKey)) {
      await consumeQuotaOrThrow({
        supabase,
        userId,
        tierContext,
        quotaKey: 'knowledge_generations_per_day',
        route: requestPath,
        increment: 1,
      });
      appliedGuards.push('quota:knowledge_generations_per_day');
    }

    if (featureKey === 'prompt_starters' && !shouldBypassLegacyQuota(featureKey)) {
      await consumeQuotaOrThrow({
        supabase,
        userId,
        tierContext,
        quotaKey: 'prompt_starters_per_day',
        route: requestPath,
        increment: 1,
      });
      appliedGuards.push('quota:prompt_starters_per_day');
    }

    if (featureKey === 'practice_exam_generation' && !shouldBypassLegacyQuota(featureKey)) {
      await consumeQuotaOrThrow({
        supabase,
        userId,
        tierContext,
        quotaKey: 'practice_exams_per_day',
        route: requestPath,
        increment: 1,
      });
      appliedGuards.push('quota:practice_exams_per_day');
    }

    if (featureKey === 'exam_predictions' && !shouldBypassLegacyQuota(featureKey)) {
      await consumeQuotaOrThrow({
        supabase,
        userId,
        tierContext,
        quotaKey: 'predictions_per_day',
        route: requestPath,
        increment: 1,
      });
      appliedGuards.push('quota:predictions_per_day');
    }

    if (featureKey === 'document_upload' && !shouldBypassLegacyQuota(featureKey)) {
      const action = String(body?.action || '').toLowerCase();
      if (action === 'initiate' || action === 'complete') {
        // Canonical document-upload limits are enforced later in the proxy request
        // via getEffectiveLimits() + throwUploadLimitIfNeeded()/throwIngestLimitIfNeeded().
        // Leaving a second hardcoded gate here causes admin-saved plan rules to drift.
        appliedGuards.push('limit:document_upload_canonical_proxy');
      }
    }
  }

  return { tierContext, body, appliedGuards };
}
