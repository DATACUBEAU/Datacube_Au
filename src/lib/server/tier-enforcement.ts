import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatureFlagBoolean } from '@/lib/server/feature-flags';
import { getProEntitlementStatus } from '@/lib/server/entitlements';
import {
  DEFAULT_MAX_UPLOAD_MB,
  FLAGGED_MAX_UPLOAD_MB,
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
  return code === '42883' || message.includes('function') && message.includes('does not exist');
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

async function resolveUploadMaxMb(supabase: SupabaseClient): Promise<number> {
  const enabled = await getFeatureFlagBoolean(supabase, 'upload_100mb', false);
  return enabled ? FLAGGED_MAX_UPLOAD_MB : DEFAULT_MAX_UPLOAD_MB;
}

async function enforceUploadSizeOrThrow(input: {
  supabase: SupabaseClient;
  body: any;
}) {
  const raw = Number(input.body?.fileSize ?? input.body?.file_size ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return;
  const sizeMb = raw / (1024 * 1024);
  const maxMb = await resolveUploadMaxMb(input.supabase);
  if (sizeMb <= maxMb) return;
  throw new TierAccessError(
    429,
    buildLimitReachedPayload({
      key: 'max_upload_size_mb',
      message: `File exceeds upload size limit (${maxMb}MB).`,
      count: Math.ceil(sizeMb),
      limit: maxMb,
      resetAt: null,
    })
  );
}

async function enforceConcurrentJobLimitOrThrow(input: {
  supabase: SupabaseClient;
  userId: string;
  tierContext: TierContext;
}) {
  const cap = isProLikeTier(input.tierContext.tier)
    ? TIER_TUNING_POLICY.concurrentJobs.pro
    : TIER_TUNING_POLICY.concurrentJobs.free;
  const { count, error } = await input.supabase
    .from('au_worker_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', input.userId)
    .in('status', ['queued', 'uploaded', 'processing']);
  if (error) return;
  const activeCount = Number(count || 0);
  if (activeCount < cap) return;
  throw new TierAccessError(
    429,
    buildLimitReachedPayload({
      key: 'max_jobs_concurrent',
      message: `Too many active jobs. Your plan allows ${cap} concurrent jobs.`,
      count: activeCount,
      limit: cap,
      resetAt: null,
    })
  );
}

async function enforceDocumentUploadQuotaOrThrow(input: {
  supabase: SupabaseClient;
  userId: string;
  tierContext: TierContext;
  documentId: string;
  route: string;
}) {
  const documentId = String(input.documentId || '').trim();
  if (!documentId) return;

  try {
    const rpcResult = await input.supabase.rpc('consume_document_upload_quota', {
      p_user_id: input.userId,
      p_document_id: documentId,
      p_tier: quotaTierForRpc(input.tierContext.runtimeTier),
    });
    if (rpcResult.error) throw rpcResult.error;
    const data = (rpcResult.data || {}) as QuotaConsumeResponse & { consumed?: boolean };
    if (data.allowed !== false) return;

    await logLimitEvent({
      supabase: input.supabase,
      userId: input.userId,
      key: 'max_documents_uploaded_total',
      route: input.route,
      tier: input.tierContext.runtimeTier,
      metadata: {
        documentId,
        count: data.count ?? null,
        limit: data.limit ?? null,
        period_end: data.period_end ?? null,
      },
    });

    throw new TierAccessError(
      429,
      buildLimitReachedPayload({
        key: 'max_documents_uploaded_total',
        message: limitMessage('max_documents_uploaded_total'),
        count: typeof data.count === 'number' ? data.count : undefined,
        limit: typeof data.limit === 'number' ? data.limit : null,
        resetAt: typeof data.period_end === 'string' ? data.period_end : null,
      })
    );
  } catch (error: any) {
    if (isUndefinedFunctionError(error)) {
      await consumeQuotaOrThrow({
        supabase: input.supabase,
        userId: input.userId,
        tierContext: input.tierContext,
        quotaKey: 'max_documents_uploaded_total',
        route: input.route,
        increment: 1,
        metadata: { documentId, fallback: true },
      });
      return;
    }
    if (error instanceof TierAccessError) throw error;
    if (isUndefinedColumnError(error)) {
      await consumeQuotaOrThrow({
        supabase: input.supabase,
        userId: input.userId,
        tierContext: input.tierContext,
        quotaKey: 'max_documents_uploaded_total',
        route: input.route,
        increment: 1,
        metadata: { documentId, fallback: true },
      });
      return;
    }
    throw error;
  }
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
  strictFreeMode: boolean;
}) {
  const model = String(input.model || '').trim().toLowerCase();
  if (!model) return;
  const isFreeModel = model.endsWith(':free');
  if (isProLikeTier(input.tierContext.tier) && isFreeModel) {
    throw new TierAccessError(503, {
      error: 'MODEL_POLICY_VIOLATION',
      key: 'premium_models',
      message: 'Pro routing selected a free model, which is blocked by policy.',
    });
  }
  if (input.strictFreeMode && !isProLikeTier(input.tierContext.tier) && !isFreeModel) {
    throw new TierAccessError(402, buildProRequiredPayload('premium_models'));
  }
}

export async function resolveUserTierContext(
  supabase: SupabaseClient,
  userId: string
): Promise<TierContext> {
  let entitlement: {
    hasPro: boolean;
    source: 'paid' | 'promo' | 'none';
    endsAt: string | null;
  } = {
    hasPro: false,
    source: 'none',
    endsAt: null as string | null,
  };

  try {
    const resolved = await getProEntitlementStatus(supabase, userId);
    entitlement = {
      hasPro: resolved.hasPro,
      source: resolved.source,
      endsAt: resolved.endsAt,
    };
  } catch (error: any) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    const schemaDrift =
      code === '42P01' ||
      code === '42703' ||
      (message.includes('relation') && message.includes('does not exist')) ||
      (message.includes('column') && message.includes('does not exist'));
    if (!schemaDrift) throw error;
  }

  let tier: TierId = 'FREE';
  if (entitlement.hasPro) {
    tier = entitlement.source === 'promo' ? 'PROMO_PRO' : 'PRO';
  }

  if (!entitlement.hasPro) {
    const { data } = await supabase
      .from('au_user_profiles')
      .select('tier')
      .eq('user_id', userId)
      .maybeSingle();
    const profileTier = String((data as any)?.tier || '').toLowerCase();
    if (profileTier === 'admin' || profileTier === 'pro' || profileTier === 'premium' || profileTier === 'weekly' || profileTier === 'monthly') {
      tier = 'PRO';
    }
  }

  return {
    tier,
    runtimeTier: toTierRuntime(tier),
    planForRouting: isProLikeTier(tier) ? 'pro' : 'free',
    entitlementSource: entitlement.source,
    expiresAt: entitlement.endsAt,
  };
}

function shouldSkipQuotaForBody(functionName: string, body: any): boolean {
  const normalized = normalizeFunctionName(functionName);
  if ((normalized === 'chat' || normalized === 'au-chat') && String(body?.action || '').toLowerCase() === 'get_models') {
    return true;
  }
  return false;
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

  if (!isFeatureAllowedForTier(featureKey, tierContext.tier)) {
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
      if (!shouldSkipQuotaForBody(functionName, body)) {
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

    if (featureKey === 'knowledge_generation') {
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

    if (featureKey === 'prompt_starters') {
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

    if (featureKey === 'practice_exam_generation') {
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

    if (featureKey === 'exam_predictions') {
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

    if (featureKey === 'document_upload') {
      const action = String(body?.action || '').toLowerCase();
      if (action === 'initiate' || action === 'complete') {
        await enforceUploadSizeOrThrow({ supabase, body });
        appliedGuards.push('limit:max_upload_size_mb');
      }
      if (action === 'complete') {
        await enforceConcurrentJobLimitOrThrow({ supabase, userId, tierContext });
        appliedGuards.push('limit:max_jobs_concurrent');
        await enforceDocumentUploadQuotaOrThrow({
          supabase,
          userId,
          tierContext,
          documentId: String(body?.documentId || ''),
          route: requestPath,
        });
        appliedGuards.push('quota:max_documents_uploaded_total');
      }
    }
  }

  return { tierContext, body, appliedGuards };
}
