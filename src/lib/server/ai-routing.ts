import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatureFlagBoolean } from '@/lib/server/feature-flags';

export type RoutingRequestType =
  | 'chat'
  | 'global_chat'
  | 'knowledge'
  | 'prediction_engine'
  | 'exam_generator'
  | 'other';

type RoutingTier = 'free' | 'pro';
type KeyTableName = 'ai_provider_keys' | 'au_api_keys';

type ProviderKeyRow = {
  service: string;
  key_value: string;
  is_active: boolean;
  error_count: number | null;
  last_used_at: string | null;
  provider_type: string | null;
  metadata: Record<string, unknown> | null;
  allowed_models: unknown;
};

export type ModelRoutingFlags = {
  tierSplitEnabled: boolean;
  paidDefaultEnabled: boolean;
};

export type RoutingCandidate = {
  service: string;
  apiKey: string;
  model: string;
  errorCount: number;
  tierWanted: RoutingTier;
  requestType: RoutingRequestType;
  keyTable: KeyTableName;
  keyMetadata: Record<string, unknown>;
  flags: ModelRoutingFlags;
};

export type SelectProviderAndModelInput = {
  supabase: SupabaseClient;
  userId: string;
  plan: string | null | undefined;
  requestType: RoutingRequestType;
};

export class ModelRoutingError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const PRO_MODEL_PREFERENCES: Record<RoutingRequestType, string[]> = {
  chat: [
    'openai/gpt-4.1-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
    'openai/gpt-4o-mini',
  ],
  global_chat: [
    'openai/gpt-4.1-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
    'openai/gpt-4o-mini',
  ],
  knowledge: [
    'openai/gpt-4.1-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
  ],
  prediction_engine: [
    'openai/gpt-4.1-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
  ],
  exam_generator: [
    'openai/gpt-4.1-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
  ],
  other: ['openai/gpt-4.1-mini', 'openai/gpt-4o-mini'],
};

const FREE_MODEL_PREFERENCES: Record<RoutingRequestType, string[]> = {
  chat: ['meta-llama/llama-3.1-8b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
  global_chat: ['meta-llama/llama-3.1-8b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
  knowledge: ['meta-llama/llama-3.1-8b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
  prediction_engine: ['meta-llama/llama-3.1-8b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
  exam_generator: ['meta-llama/llama-3.1-8b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
  other: ['meta-llama/llama-3.1-8b-instruct:free'],
};

let keyTableCache: { table: KeyTableName | null; ts: number } | null = null;
const KEY_TABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const ERROR_THRESHOLD = 8;
const DEFAULT_429_COOLDOWN_SECONDS = 45;

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return toArray(parsed);
      } catch {
        return [];
      }
    }
    return [trimmed];
  }
  return [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function normalizePlanToTier(plan: string | null | undefined): RoutingTier {
  const normalized = String(plan || 'free').trim().toLowerCase();
  if (
    normalized === 'pro' ||
    normalized === 'premium' ||
    normalized === 'monthly' ||
    normalized === 'weekly' ||
    normalized === 'admin'
  ) {
    return 'pro';
  }
  return 'free';
}

function readMetadataTier(metadata: Record<string, unknown>): RoutingTier | null {
  const tier = String(metadata?.tier || '').trim().toLowerCase();
  if (tier === 'pro' || tier === 'free') return tier;
  return null;
}

function readCooldownUntilMs(metadata: Record<string, unknown>): number | null {
  const raw = metadata?.cooldown_until || metadata?.cooldownUntil;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function modelIsFree(model: string): boolean {
  return model.trim().toLowerCase().endsWith(':free');
}

async function resolveKeyTable(supabase: SupabaseClient): Promise<KeyTableName | null> {
  const now = Date.now();
  if (keyTableCache && now - keyTableCache.ts < KEY_TABLE_CACHE_TTL_MS) {
    return keyTableCache.table;
  }

  const checks: KeyTableName[] = ['ai_provider_keys', 'au_api_keys'];
  for (const table of checks) {
    const { error } = await supabase.from(table).select('service', { count: 'exact', head: true }).limit(1);
    if (!error) {
      keyTableCache = { table, ts: now };
      return table;
    }
    if (!isMissingTableError(error)) {
      throw error;
    }
  }

  keyTableCache = { table: null, ts: now };
  return null;
}

export async function getModelRoutingFlags(supabase: SupabaseClient): Promise<ModelRoutingFlags> {
  const tierSplitEnabled = await getFeatureFlagBoolean(
    supabase,
    'model_routing.tier_split_enabled',
    false
  );
  const paidDefaultEnabled = await getFeatureFlagBoolean(
    supabase,
    'model_routing.paid_default_enabled',
    true
  );

  return {
    tierSplitEnabled,
    paidDefaultEnabled,
  };
}

function decideTierWanted(plan: string | null | undefined, flags: ModelRoutingFlags): RoutingTier {
  if (flags.tierSplitEnabled) {
    return normalizePlanToTier(plan);
  }
  // Safety default: when split is off, always route to paid tier.
  return flags.paidDefaultEnabled ? 'pro' : 'pro';
}

function preferredModelsFor(requestType: RoutingRequestType, tier: RoutingTier): string[] {
  const source = tier === 'pro' ? PRO_MODEL_PREFERENCES : FREE_MODEL_PREFERENCES;
  return source[requestType] || source.other;
}

function modelsForRow(
  row: ProviderKeyRow,
  requestType: RoutingRequestType,
  tierWanted: RoutingTier
): string[] {
  const metadata = normalizeMetadata(row.metadata);
  const rowAllowed = unique([
    ...toArray(row.allowed_models),
    ...toArray((metadata as any)?.allowed_models),
  ]);
  const preferred = preferredModelsFor(requestType, tierWanted);

  let candidateModels: string[] = [];
  if (rowAllowed.length > 0) {
    candidateModels = preferred.filter((model) => rowAllowed.includes(model));
    if (candidateModels.length === 0) {
      candidateModels = rowAllowed;
    }
  } else {
    candidateModels = preferred;
  }

  if (tierWanted === 'pro') {
    candidateModels = candidateModels.filter((model) => !modelIsFree(model));
  } else {
    // Keep free-tier requests pinned to free models only.
    candidateModels = candidateModels.filter((model) => modelIsFree(model));
  }

  return unique(candidateModels.filter(Boolean));
}

function sortKeys(a: ProviderKeyRow, b: ProviderKeyRow): number {
  const errA = Number.isFinite(Number(a.error_count)) ? Number(a.error_count) : 0;
  const errB = Number.isFinite(Number(b.error_count)) ? Number(b.error_count) : 0;
  if (errA !== errB) return errA - errB;

  const usedA = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
  const usedB = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
  return usedA - usedB;
}

export async function buildRoutingCandidates(
  input: SelectProviderAndModelInput
): Promise<{ tierWanted: RoutingTier; flags: ModelRoutingFlags; candidates: RoutingCandidate[] }> {
  const { supabase, requestType, plan } = input;
  const flags = await getModelRoutingFlags(supabase);
  const tierWanted = decideTierWanted(plan, flags);
  const keyTable = await resolveKeyTable(supabase);

  if (!keyTable) {
    throw new ModelRoutingError(
      503,
      'routing_table_missing',
      'No provider key table is available for model routing.'
    );
  }

  const { data, error } = await supabase
    .from(keyTable)
    .select('service,key_value,is_active,error_count,last_used_at,provider_type,metadata,allowed_models')
    .eq('provider_type', 'openrouter')
    .eq('is_active', true);

  if (error) {
    throw new ModelRoutingError(503, 'routing_key_fetch_failed', error.message, {
      table: keyTable,
    });
  }

  const now = Date.now();
  const rows = ((data || []) as ProviderKeyRow[])
    .filter((row) => Boolean(row?.service) && Boolean(row?.key_value))
    .filter((row) => String(row?.provider_type || '').toLowerCase() === 'openrouter')
    .filter((row) => {
      const metadata = normalizeMetadata(row.metadata);
      const rowTier = readMetadataTier(metadata);
      if (rowTier !== tierWanted) return false;

      const cooldownUntilMs = readCooldownUntilMs(metadata);
      if (cooldownUntilMs && cooldownUntilMs > now) return false;

      const errorCount = Number(row.error_count || 0);
      if (errorCount >= ERROR_THRESHOLD) return false;
      return true;
    })
    .sort(sortKeys);

  const candidates: RoutingCandidate[] = [];
  for (const row of rows) {
    const metadata = normalizeMetadata(row.metadata);
    const models = modelsForRow(row, requestType, tierWanted);
    for (const model of models) {
      if (tierWanted === 'pro' && modelIsFree(model)) {
        continue;
      }
      candidates.push({
        service: row.service,
        apiKey: row.key_value,
        model,
        errorCount: Number(row.error_count || 0),
        tierWanted,
        requestType,
        keyTable,
        keyMetadata: metadata,
        flags,
      });
    }
  }

  if (candidates.length === 0) {
    throw new ModelRoutingError(
      503,
      'routing_no_candidates',
      `No eligible ${tierWanted} routing candidates for ${requestType}.`,
      {
        tierWanted,
        requestType,
        tierSplitEnabled: flags.tierSplitEnabled,
      }
    );
  }

  return { tierWanted, flags, candidates };
}

export async function selectProviderAndModel(
  input: SelectProviderAndModelInput
): Promise<RoutingCandidate> {
  const { candidates } = await buildRoutingCandidates(input);
  return candidates[0];
}

export async function noteRoutingSuccess(
  supabase: SupabaseClient,
  candidate: RoutingCandidate
): Promise<void> {
  const nextMetadata: Record<string, unknown> = {
    ...(candidate.keyMetadata || {}),
  };
  delete (nextMetadata as any).cooldown_until;
  delete (nextMetadata as any).cooldownUntil;
  nextMetadata.last_success_at = new Date().toISOString();

  await supabase
    .from(candidate.keyTable)
    .update({
      last_used_at: new Date().toISOString(),
      metadata: nextMetadata,
    })
    .eq('service', candidate.service);
}

function extractRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.ceil(asNumber);
  const asDate = new Date(value).getTime();
  if (!Number.isFinite(asDate)) return null;
  const secs = Math.ceil((asDate - Date.now()) / 1000);
  return secs > 0 ? secs : null;
}

export async function noteRoutingFailure(
  supabase: SupabaseClient,
  candidate: RoutingCandidate,
  status: number,
  retryAfterHeader?: string | null
): Promise<void> {
  const metadata: Record<string, unknown> = {
    ...(candidate.keyMetadata || {}),
    last_error_status: status,
    last_error_at: new Date().toISOString(),
  };

  const patch: Record<string, unknown> = {
    metadata,
  };

  if (status === 429) {
    const cooldownSeconds =
      extractRetryAfterSeconds(retryAfterHeader) || DEFAULT_429_COOLDOWN_SECONDS;
    metadata.cooldown_until = new Date(Date.now() + cooldownSeconds * 1000).toISOString();
    metadata.last_429_cooldown_seconds = cooldownSeconds;
  } else if (status >= 500 || status === 408) {
    patch.error_count = Number(candidate.errorCount || 0) + 1;
  }

  await supabase
    .from(candidate.keyTable)
    .update(patch)
    .eq('service', candidate.service);
}

export function logRoutingDecision(input: {
  requestType: RoutingRequestType;
  userId: string;
  plan: string | null | undefined;
  candidate: RoutingCandidate;
}) {
  const payload = {
    requestType: input.requestType,
    userId: input.userId,
    plan: input.plan || 'free',
    tierWanted: input.candidate.tierWanted,
    service: input.candidate.service,
    model: input.candidate.model,
    tierSplitEnabled: input.candidate.flags.tierSplitEnabled,
  };
  console.info('[ai-routing]', JSON.stringify(payload));
}
