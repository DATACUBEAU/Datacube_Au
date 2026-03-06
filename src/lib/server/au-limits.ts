import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatureFlagsSnapshot } from '@/lib/server/feature-flags';
import { getProEntitlementStatus } from '@/lib/server/entitlements';

const ONE_MB_BYTES = 1024 * 1024;
const ROLLING_TOKEN_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_PLAN_LIMITS = {
  free: {
    max_file_size_mb: 50,
    max_uploads_total: 50,
    max_documents_total: 50,
    max_chats_total: 3000,
    max_exams_total: 10,
    max_tokens_total: 25_000,
    max_storage_mb: 2_000,
    max_concurrent_jobs: 1,
  },
  pro: {
    max_file_size_mb: 50,
    max_uploads_total: 500,
    max_documents_total: 500,
    max_chats_total: 30_000,
    max_exams_total: 200,
    max_tokens_total: 2_500_000,
    max_storage_mb: 20_000,
    max_concurrent_jobs: 3,
  },
} as const;

export const LIMIT_COLUMN_KEYS = [
  'max_file_size_mb',
  'max_uploads_total',
  'max_documents_total',
  'max_chats_total',
  'max_exams_total',
  'max_tokens_total',
  'max_storage_mb',
  'max_concurrent_jobs',
] as const;

const LIMIT_ALIASES: Record<(typeof LIMIT_COLUMN_KEYS)[number], string[]> = {
  max_file_size_mb: ['max_file_mb'],
  max_uploads_total: ['max_uploads_total'],
  max_documents_total: ['max_docs_total'],
  max_chats_total: ['max_chats_total'],
  max_exams_total: ['max_exams_total'],
  max_tokens_total: ['max_tokens_total'],
  max_storage_mb: ['max_storage_mb'],
  max_concurrent_jobs: ['max_jobs_concurrent'],
};

export type EffectivePlanCode = keyof typeof DEFAULT_PLAN_LIMITS;
export type CanonicalLimitKey = (typeof LIMIT_COLUMN_KEYS)[number];
export type CanonicalPlanLimits = Record<CanonicalLimitKey, number>;

export type EffectivePlan = {
  plan: EffectivePlanCode;
  isAdmin: boolean;
  hasPro: boolean;
  source: 'au_user_entitlements' | 'profile' | 'billing' | 'default';
};

export type EffectiveUsage = {
  today: Record<string, number>;
  total: Record<string, number>;
  reset_at: string | null;
};

export type EffectiveLimitsResult = {
  plan: EffectivePlanCode;
  effectivePlan: EffectivePlan;
  limits: Record<string, number>;
  canonicalLimits: CanonicalPlanLimits;
  usage: EffectiveUsage;
};

export type LimitPayload = {
  status: number;
  code: string;
  message: string;
  limit: string;
  current: number;
  action: string;
  correlation_id: string;
  max?: number;
  used?: number;
  reset_at?: string | null;
};

export class EffectiveLimitError extends Error {
  status: number;
  payload: LimitPayload;
  headers: Record<string, string>;

  constructor(status: number, payload: LimitPayload, headers?: Record<string, string>) {
    super(payload.message);
    this.status = status;
    this.payload = payload;
    this.headers = headers || {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('does not exist') ||
    details.includes('does not exist')
  );
}

function clampNonNegativeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

function normalizePlan(value: unknown): EffectivePlanCode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'pro' || raw === 'promo_pro' || raw === 'premium' || raw === 'weekly' || raw === 'monthly') {
    return 'pro';
  }
  return 'free';
}

function normalizeProfileTier(value: unknown): { isAdmin: boolean; plan: EffectivePlanCode | null } {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return { isAdmin: false, plan: null };
  if (raw === 'admin') return { isAdmin: true, plan: 'pro' };
  if (['pro', 'premium', 'weekly', 'monthly', 'paid'].includes(raw)) return { isAdmin: false, plan: 'pro' };
  if (raw === 'free') return { isAdmin: false, plan: 'free' };
  return { isAdmin: false, plan: null };
}

function withAliases(limits: CanonicalPlanLimits): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of LIMIT_COLUMN_KEYS) {
    out[key] = limits[key];
    for (const alias of LIMIT_ALIASES[key]) {
      out[alias] = limits[key];
    }
  }
  return out;
}

function fromLegacyPlanLimits(input: unknown, fallbackPlan: EffectivePlanCode): CanonicalPlanLimits {
  const source = asRecord(input);
  const defaults = DEFAULT_PLAN_LIMITS[fallbackPlan];
  return {
    max_file_size_mb: clampNonNegativeNumber(source.max_file_size_mb ?? source.max_file_mb, defaults.max_file_size_mb),
    max_uploads_total: clampNonNegativeNumber(source.max_uploads_total, defaults.max_uploads_total),
    max_documents_total: clampNonNegativeNumber(source.max_documents_total ?? source.max_docs_total, defaults.max_documents_total),
    max_chats_total: clampNonNegativeNumber(source.max_chats_total ?? source.max_messages_per_day, defaults.max_chats_total),
    max_exams_total: clampNonNegativeNumber(source.max_exams_total, defaults.max_exams_total),
    max_tokens_total: clampNonNegativeNumber(source.max_tokens_total ?? source.max_tokens_per_day, defaults.max_tokens_total),
    max_storage_mb: clampNonNegativeNumber(source.max_storage_mb, defaults.max_storage_mb),
    max_concurrent_jobs: clampNonNegativeNumber(source.max_concurrent_jobs ?? source.max_jobs_concurrent, defaults.max_concurrent_jobs),
  };
}

export async function resolveEffectivePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectivePlan> {
  const [entitlementRes, profileRes] = await Promise.all([
    supabase
      .from('au_user_entitlements')
      .select('plan')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('au_user_profiles')
      .select('tier')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const profileInfo = normalizeProfileTier(profileRes.data?.tier);

  if (!entitlementRes.error && entitlementRes.data?.plan) {
    const plan = normalizePlan(entitlementRes.data.plan);
    return {
      plan: profileInfo.isAdmin ? 'pro' : plan,
      isAdmin: profileInfo.isAdmin,
      hasPro: profileInfo.isAdmin || plan === 'pro',
      source: 'au_user_entitlements',
    };
  }

  if (profileInfo.plan) {
    return {
      plan: profileInfo.plan,
      isAdmin: profileInfo.isAdmin,
      hasPro: profileInfo.isAdmin || profileInfo.plan === 'pro',
      source: 'profile',
    };
  }

  try {
    const pro = await getProEntitlementStatus(supabase, userId);
    return {
      plan: pro.hasPro ? 'pro' : 'free',
      isAdmin: profileInfo.isAdmin,
      hasPro: profileInfo.isAdmin || pro.hasPro,
      source: 'billing',
    };
  } catch {
    return {
      plan: profileInfo.isAdmin ? 'pro' : 'free',
      isAdmin: profileInfo.isAdmin,
      hasPro: profileInfo.isAdmin,
      source: 'default',
    };
  }
}

export async function loadPlanLimits(
  supabase: SupabaseClient,
  plan: EffectivePlanCode,
): Promise<CanonicalPlanLimits> {
  const defaults = DEFAULT_PLAN_LIMITS[plan];
  const primary = await supabase
    .from('au_plan_limits')
    .select(LIMIT_COLUMN_KEYS.join(','))
    .eq('plan', plan)
    .maybeSingle();

  if (!primary.error && primary.data) {
    return fromLegacyPlanLimits(primary.data, plan);
  }

  if (!isSchemaDriftError(primary.error)) {
    throw primary.error;
  }

  const fallback = await supabase
    .from('plan_limits')
    .select('limits,effective_from')
    .eq('plan', plan)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fallback.error && fallback.data?.limits) {
    return fromLegacyPlanLimits(fallback.data.limits, plan);
  }

  return { ...defaults };
}

async function isProUploadFlagEnabled(supabase: SupabaseClient): Promise<boolean> {
  const flags = await getFeatureFlagsSnapshot(supabase).catch(() => new Map());
  return Boolean(flags.get('pro_upload_100mb')?.enabled || flags.get('upload_100mb')?.enabled);
}

function applyLimitOverrides(plan: EffectivePlanCode, limits: CanonicalPlanLimits, proUpload100Enabled: boolean): CanonicalPlanLimits {
  const next = { ...limits };
  next.max_file_size_mb = plan === 'pro' && proUpload100Enabled ? 100 : 50;
  return next;
}

async function safeSelectDocuments(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ id: string; file_size_bytes: number | null }>> {
  const res = await supabase
    .from('au_documents')
    .select('id,file_size_bytes')
    .or(`owner_id.eq.${userId},user_id.eq.${userId}`);

  if (res.error && !isSchemaDriftError(res.error)) {
    throw res.error;
  }

  if (!res.error) {
    return (res.data || []) as Array<{ id: string; file_size_bytes: number | null }>;
  }

  const fallback = await supabase
    .from('au_documents')
    .select('id,file_size_bytes')
    .eq('user_id', userId);

  if (fallback.error) {
    if (isSchemaDriftError(fallback.error)) return [];
    throw fallback.error;
  }

  return (fallback.data || []) as Array<{ id: string; file_size_bytes: number | null }>;
}

async function safeExactCount(
  supabase: SupabaseClient,
  table: string,
  options: {
    userId?: string;
    ownerOrUser?: boolean;
    featureFilter?: string;
    statuses?: string[];
  } = {},
): Promise<number> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });

  if (options.ownerOrUser && options.userId) {
    query = query.or(`owner_id.eq.${options.userId},user_id.eq.${options.userId}`);
  } else if (options.userId) {
    query = query.eq('user_id', options.userId);
  }

  if (options.featureFilter) {
    query = query.eq('feature', options.featureFilter);
  }

  if (options.statuses && options.statuses.length > 0) {
    query = query.in('status', options.statuses);
  }

  const { count, error } = await query;
  if (error) {
    if (isSchemaDriftError(error)) return 0;
    throw error;
  }
  return Number(count || 0);
}

async function safeTokenUsage(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tokensToday: number; tokensTotal: number }> {
  const sinceIso = new Date(Date.now() - ROLLING_TOKEN_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('au_model_usage')
    .select('total_tokens,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    if (isSchemaDriftError(error)) return { tokensToday: 0, tokensTotal: 0 };
    throw error;
  }

  let tokensToday = 0;
  let tokensTotal = 0;
  for (const row of data || []) {
    const tokens = clampNonNegativeNumber((row as any)?.total_tokens, 0);
    tokensTotal += tokens;
    const createdAt = String((row as any)?.created_at || '');
    if (createdAt && createdAt >= sinceIso) {
      tokensToday += tokens;
    }
  }

  return { tokensToday, tokensTotal };
}

async function buildUsageSnapshot(supabase: SupabaseClient, userId: string): Promise<EffectiveUsage> {
  const [documentRows, runningJobs, chatsTotal, examsTotal, tokenUsage] = await Promise.all([
    safeSelectDocuments(supabase, userId),
    safeExactCount(supabase, 'au_worker_jobs', {
      userId,
      ownerOrUser: true,
      statuses: ['queued', 'uploaded', 'processing'],
    }),
    safeExactCount(supabase, 'au_messages', { userId }),
    safeExactCount(supabase, 'au_feature_outputs', {
      userId,
      featureFilter: 'practice_exam_generation',
    }),
    safeTokenUsage(supabase, userId),
  ]);

  const documentsTotal = documentRows.length;
  const uploadsTotal = documentsTotal;
  const usedStorageBytes = documentRows.reduce((sum, row) => sum + clampNonNegativeNumber(row.file_size_bytes, 0), 0);
  const usedStorageMb = Math.ceil(usedStorageBytes / ONE_MB_BYTES);

  return {
    today: {
      used_tokens: tokenUsage.tokensToday,
      tokens_used: tokenUsage.tokensToday,
    },
    total: {
      used_uploads: uploadsTotal,
      uploads_count: uploadsTotal,
      used_documents: documentsTotal,
      documents_count: documentsTotal,
      used_chats: chatsTotal,
      messages_count: chatsTotal,
      used_exams: examsTotal,
      exams_count: examsTotal,
      used_tokens: tokenUsage.tokensToday,
      tokens_used: tokenUsage.tokensToday,
      used_storage_mb: usedStorageMb,
      uploaded_mb: usedStorageMb,
      running_jobs: runningJobs,
      active_jobs: runningJobs,
    },
    reset_at: new Date(Date.now() + ROLLING_TOKEN_WINDOW_MS).toISOString(),
  };
}

export async function getEffectiveLimits(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectiveLimitsResult> {
  const effectivePlan = await resolveEffectivePlan(supabase, userId);
  const [planLimits, usage, proUpload100Enabled] = await Promise.all([
    loadPlanLimits(supabase, effectivePlan.plan),
    buildUsageSnapshot(supabase, userId),
    isProUploadFlagEnabled(supabase),
  ]);

  const canonicalLimits = applyLimitOverrides(effectivePlan.plan, planLimits, proUpload100Enabled);

  return {
    plan: effectivePlan.plan,
    effectivePlan,
    limits: withAliases(canonicalLimits),
    canonicalLimits,
    usage,
  };
}

function buildLimitPayload(params: {
  status: number;
  code: string;
  message: string;
  limit: string;
  current: number;
  max?: number;
  action: string;
  correlationId: string;
  resetAt?: string | null;
}): LimitPayload {
  return {
    status: params.status,
    code: params.code,
    message: params.message,
    limit: params.limit,
    current: params.current,
    used: params.current,
    max: params.max,
    action: params.action,
    correlation_id: params.correlationId,
    reset_at: params.resetAt || null,
  };
}

export function throwUploadLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  fileSizeBytes: number;
  correlationId: string;
}): void {
  const { canonicalLimits, usage } = input.limits;
  const fileSizeMb = Math.ceil(input.fileSizeBytes / ONE_MB_BYTES);
  const usedStorageMb = clampNonNegativeNumber(usage.total.used_storage_mb, 0);
  const uploadsTotal = clampNonNegativeNumber(usage.total.used_uploads, 0);

  if (fileSizeMb > canonicalLimits.max_file_size_mb) {
    throw new EffectiveLimitError(
      413,
      buildLimitPayload({
        status: 413,
        code: 'LIMIT_EXCEEDED',
        message: `File exceeds upload size limit (${canonicalLimits.max_file_size_mb}MB).`,
        limit: 'max_file_size_mb',
        current: fileSizeMb,
        max: canonicalLimits.max_file_size_mb,
        action: 'upload_init',
        correlationId: input.correlationId,
      }),
    );
  }

  if (uploadsTotal + 1 > canonicalLimits.max_uploads_total) {
    throw new EffectiveLimitError(
      403,
      buildLimitPayload({
        status: 403,
        code: 'LIMIT_REACHED',
        message: 'Upload quota reached for this account.',
        limit: 'max_uploads_total',
        current: uploadsTotal,
        max: canonicalLimits.max_uploads_total,
        action: 'upload_init',
        correlationId: input.correlationId,
      }),
    );
  }

  if (usedStorageMb + fileSizeMb > canonicalLimits.max_storage_mb) {
    throw new EffectiveLimitError(
      409,
      buildLimitPayload({
        status: 409,
        code: 'LIMIT_EXCEEDED',
        message: 'Storage quota would be exceeded by this upload.',
        limit: 'max_storage_mb',
        current: usedStorageMb,
        max: canonicalLimits.max_storage_mb,
        action: 'upload_init',
        correlationId: input.correlationId,
      }),
    );
  }
}

export function throwIngestLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
}): void {
  const { canonicalLimits, usage } = input.limits;
  const documentsTotal = clampNonNegativeNumber(usage.total.used_documents, 0);
  const runningJobs = clampNonNegativeNumber(usage.total.running_jobs, 0);

  if (documentsTotal + 1 > canonicalLimits.max_documents_total) {
    throw new EffectiveLimitError(
      403,
      buildLimitPayload({
        status: 403,
        code: 'LIMIT_REACHED',
        message: 'Document limit reached for this account.',
        limit: 'max_documents_total',
        current: documentsTotal,
        max: canonicalLimits.max_documents_total,
        action: 'document_ingest',
        correlationId: input.correlationId,
      }),
    );
  }

  if (runningJobs >= canonicalLimits.max_concurrent_jobs) {
    throw new EffectiveLimitError(
      429,
      buildLimitPayload({
        status: 429,
        code: 'LIMIT_REACHED',
        message: 'Too many active jobs. Retry after an active job completes.',
        limit: 'max_concurrent_jobs',
        current: runningJobs,
        max: canonicalLimits.max_concurrent_jobs,
        action: 'document_ingest',
        correlationId: input.correlationId,
      }),
      { 'retry-after': '60' },
    );
  }
}

export function throwChatLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
}): void {
  const { canonicalLimits, usage } = input.limits;
  const chatsTotal = clampNonNegativeNumber(usage.total.used_chats, 0);
  const tokensToday = clampNonNegativeNumber(usage.today.used_tokens, 0);

  if (chatsTotal + 1 > canonicalLimits.max_chats_total) {
    throw new EffectiveLimitError(
      403,
      buildLimitPayload({
        status: 403,
        code: 'LIMIT_REACHED',
        message: 'Chat limit reached for this account.',
        limit: 'max_chats_total',
        current: chatsTotal,
        max: canonicalLimits.max_chats_total,
        action: 'chat',
        correlationId: input.correlationId,
      }),
    );
  }

  if (tokensToday >= canonicalLimits.max_tokens_total) {
    throw new EffectiveLimitError(
      429,
      buildLimitPayload({
        status: 429,
        code: 'TOKEN_BUDGET_EXCEEDED',
        message: 'Daily token budget exceeded. Retry later.',
        limit: 'max_tokens_total',
        current: tokensToday,
        max: canonicalLimits.max_tokens_total,
        action: 'chat',
        correlationId: input.correlationId,
        resetAt: usage.reset_at,
      }),
      { 'retry-after': '3600' },
    );
  }
}

export function throwExamLimitIfNeeded(input: {
  limits: EffectiveLimitsResult;
  correlationId: string;
  action?: string;
}): void {
  const { canonicalLimits, usage } = input.limits;
  const examsTotal = clampNonNegativeNumber(usage.total.used_exams, 0);

  if (examsTotal + 1 > canonicalLimits.max_exams_total) {
    throw new EffectiveLimitError(
      403,
      buildLimitPayload({
        status: 403,
        code: 'LIMIT_REACHED',
        message: 'Exam generation limit reached for this account.',
        limit: 'max_exams_total',
        current: examsTotal,
        max: canonicalLimits.max_exams_total,
        action: input.action || 'exam_generation',
        correlationId: input.correlationId,
      }),
    );
  }
}
