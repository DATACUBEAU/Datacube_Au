import type { SupabaseClient } from '@supabase/supabase-js';

export type RoutingRequestType =
  | 'chat'
  | 'global_chat'
  | 'knowledge'
  | 'prediction_engine'
  | 'exam_generator'
  | 'other';

type RoutingTier = 'pro';

type ProviderKeyRowRaw = {
  service: string | null;
  key_value: string | null;
  is_active: boolean | null;
  error_count: number | null;
  last_used_at: string | null;
  provider_type: string | null;
  allowed_models: unknown;
  metadata: unknown;
};

type ProviderKeyRecord = {
  service: string;
  keyValue: string;
  providerType: string;
  errorCount: number;
  lastUsedAt: string | null;
  allowedModels: string[];
  metadata: Record<string, unknown>;
};

export type ModelRoutingFlags = {
  paidOnlyMode: true;
  tierSplitEnabled: false;
  paidDefaultEnabled: true;
};

export type RoutingCandidate = {
  service: string;
  apiKey: string;
  model: string;
  errorCount: number;
  tierWanted: RoutingTier;
  requestType: RoutingRequestType;
  providerType: string;
  keyMetadata: Record<string, unknown>;
  flags: ModelRoutingFlags;
};

export type SelectProviderAndModelInput = {
  supabase: SupabaseClient;
  userId: string;
  plan: string | null | undefined;
  requestType: RoutingRequestType;
  requestedModel?: string | null;
};

export type MarkKeyErrorInput = {
  status?: number | null;
  message?: string | null;
  code?: string | null;
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

const DEFAULT_PROVIDER_TYPE = 'openrouter';
const DEFAULT_DEACTIVATE_AFTER_ERRORS = 0;
const FREE_MODEL_SUFFIX = `${String.fromCharCode(58)}free`;
const PROVIDER_KEY_TABLES = ['au_api_keys', 'ai_provider_keys'] as const;
type ProviderKeyTableName = (typeof PROVIDER_KEY_TABLES)[number];
let providerKeyTableCache: ProviderKeyTableName | null = null;

const PAID_MODEL_PREFERENCE_ORDER = [
  'google/gemini-2.5-flash-lite-preview-09-2025',
  'openai/gpt-5-nano',
  'openai/gpt-4o',
  'anthropic/claude-3.5-sonnet',
  'deepseek/deepseek-r1',
  'meta-llama/llama-3.1-405b-instruct',
  'google/gemini-pro-1.5',
] as const;

const PAID_MODEL_RANK = new Map<string, number>(
  PAID_MODEL_PREFERENCE_ORDER.map((model, idx) => [model.toLowerCase(), idx])
);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? '');
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMetadata(raw: unknown): Record<string, unknown> {
  return isObjectRecord(raw) ? raw : {};
}

function isFreeModelId(model: string): boolean {
  return String(model || '').trim().toLowerCase().endsWith(FREE_MODEL_SUFFIX);
}

function normalizeModelId(model: unknown): string {
  return String(model || '').trim();
}

function normalizeAllowedModels(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .map((entry) => normalizeModelId(entry))
          .filter((entry) => entry.length > 0)
      )
    );
  }

  if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeAllowedModels(parsed);
      } catch {
        return [];
      }
    }
    return [trimmed];
  }

  return [];
}

function toProviderKeyRecord(raw: ProviderKeyRowRaw): ProviderKeyRecord | null {
  const service = String(raw?.service || '').trim();
  const keyValue = String(raw?.key_value || '').trim();
  const providerType = String(raw?.provider_type || DEFAULT_PROVIDER_TYPE).trim().toLowerCase();

  if (!service || !keyValue || !providerType) return null;

  return {
    service,
    keyValue,
    providerType,
    errorCount: Number.isFinite(Number(raw?.error_count)) ? Number(raw?.error_count) : 0,
    lastUsedAt: raw?.last_used_at ? String(raw.last_used_at) : null,
    allowedModels: normalizeAllowedModels(raw?.allowed_models),
    metadata: normalizeMetadata(raw?.metadata),
  };
}

function sortKeysByHealthAndRotation(a: ProviderKeyRecord, b: ProviderKeyRecord): number {
  if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;

  const aUsed = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
  const bUsed = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
  if (aUsed !== bUsed) return aUsed - bUsed;

  return a.service.localeCompare(b.service);
}

function sortModelsByPreference(models: string[]): string[] {
  return [...models].sort((a, b) => {
    const rankA = PAID_MODEL_RANK.get(a.toLowerCase());
    const rankB = PAID_MODEL_RANK.get(b.toLowerCase());
    const normalizedRankA = typeof rankA === 'number' ? rankA : Number.MAX_SAFE_INTEGER;
    const normalizedRankB = typeof rankB === 'number' ? rankB : Number.MAX_SAFE_INTEGER;

    if (normalizedRankA !== normalizedRankB) return normalizedRankA - normalizedRankB;
    return a.localeCompare(b);
  });
}

function paidOnly(models: string[]): string[] {
  return models.filter((model) => !isFreeModelId(model));
}

function preferredDefaultModelFromAllowed(allowedModels: string[]): string | null {
  const paidModels = paidOnly(allowedModels);
  if (paidModels.length === 0) return null;
  return sortModelsByPreference(paidModels)[0] || null;
}

function shouldIncrementErrorCount(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function isAllowedModel(model: string, allowedModels: string[]): boolean {
  const normalized = model.toLowerCase();
  return allowedModels.some((allowed) => allowed.toLowerCase() === normalized);
}

function isMissingProviderKeyTableError(error: any, table: ProviderKeyTableName): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const tableRef = `public.${table}`.toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes(`table '${tableRef}'`) ||
    details.includes(`table '${tableRef}'`) ||
    (message.includes('schema cache') && message.includes(table.toLowerCase())) ||
    (details.includes('schema cache') && details.includes(table.toLowerCase()))
  );
}

function isMissingColumnError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === '42703' ||
    (message.includes('column') && message.includes('does not exist')) ||
    (details.includes('column') && details.includes('does not exist'))
  );
}

function providerKeyTablesInOrder(): ProviderKeyTableName[] {
  if (!providerKeyTableCache) return [...PROVIDER_KEY_TABLES];
  return [providerKeyTableCache, ...PROVIDER_KEY_TABLES.filter((table) => table !== providerKeyTableCache)];
}

async function resolveProviderKeyTableForUpdates(supabase: SupabaseClient): Promise<ProviderKeyTableName> {
  for (const table of providerKeyTablesInOrder()) {
    const { error } = await supabase.from(table).select('service').limit(1);
    if (!error) {
      providerKeyTableCache = table;
      return table;
    }
    if (!isMissingProviderKeyTableError(error, table)) {
      throw new ModelRoutingError(503, 'provider_key_fetch_failed', error.message, {
        table,
      });
    }
  }
  throw new ModelRoutingError(503, 'provider_key_fetch_failed', 'No provider key table available.', {
    tablesTried: providerKeyTablesInOrder(),
  });
}

async function fetchActiveProviderKeys(
  supabase: SupabaseClient,
  providerType: string
): Promise<ProviderKeyRecord[]> {
  const normalizedProviderType = String(providerType || DEFAULT_PROVIDER_TYPE).trim().toLowerCase();
  let data: any[] | null = null;
  let lastError: any = null;

  for (const table of providerKeyTablesInOrder()) {
    const fullQuery = await supabase
      .from(table)
      .select('service,key_value,is_active,error_count,last_used_at,provider_type,allowed_models,metadata')
      .eq('provider_type', normalizedProviderType)
      .eq('is_active', true)
      .order('error_count', { ascending: true, nullsFirst: true })
      .order('last_used_at', { ascending: true, nullsFirst: true });

    if (!fullQuery.error) {
      data = fullQuery.data || [];
      providerKeyTableCache = table;
      break;
    }

    if (isMissingColumnError(fullQuery.error) || isMissingProviderKeyTableError(fullQuery.error, table)) {
      const legacyQuery = await supabase
        .from(table)
        .select('service,key_value,is_active,error_count,last_used_at')
        .eq('is_active', true)
        .order('error_count', { ascending: true, nullsFirst: true })
        .order('last_used_at', { ascending: true, nullsFirst: true });

      if (!legacyQuery.error) {
        data = (legacyQuery.data || []).map((row: any) => ({
          ...row,
          provider_type: normalizedProviderType,
          allowed_models: [...PAID_MODEL_PREFERENCE_ORDER],
          metadata: {},
        }));
        providerKeyTableCache = table;
        break;
      }

      if (isMissingProviderKeyTableError(legacyQuery.error, table)) {
        lastError = legacyQuery.error;
        continue;
      }
      lastError = legacyQuery.error;
      break;
    }

    lastError = fullQuery.error;
    break;
  }

  if (!data && lastError) {
    throw new ModelRoutingError(503, 'provider_key_fetch_failed', lastError.message, {
      providerType: normalizedProviderType,
      table: providerKeyTableCache,
    });
  }

  const keys = ((data || []) as ProviderKeyRowRaw[])
    .map((row) => toProviderKeyRecord(row))
    .filter((row): row is ProviderKeyRecord => Boolean(row))
    .filter((row) => row.providerType === normalizedProviderType)
    .sort(sortKeysByHealthAndRotation);

  return keys;
}

function noActiveProviderKeysError(details?: Record<string, unknown>): ModelRoutingError {
  return new ModelRoutingError(503, 'no_active_provider_keys', 'no_active_provider_keys', details);
}

export async function getModelRoutingFlags(_: SupabaseClient): Promise<ModelRoutingFlags> {
  return {
    paidOnlyMode: true,
    tierSplitEnabled: false,
    paidDefaultEnabled: true,
  };
}

export async function getActiveProviderKey(
  supabase: SupabaseClient,
  providerType: string = DEFAULT_PROVIDER_TYPE
): Promise<ProviderKeyRecord> {
  const keys = await fetchActiveProviderKeys(supabase, providerType);
  if (keys.length === 0) {
    throw noActiveProviderKeysError({
      providerType: String(providerType || DEFAULT_PROVIDER_TYPE).trim().toLowerCase(),
    });
  }

  const key = keys.find((row) => preferredDefaultModelFromAllowed(row.allowedModels) !== null);
  if (!key) {
    throw noActiveProviderKeysError({
      providerType: String(providerType || DEFAULT_PROVIDER_TYPE).trim().toLowerCase(),
      reason: 'no_paid_allowed_models',
    });
  }
  return key;
}

export async function getDefaultPaidModel(
  supabase: SupabaseClient,
  providerType: string = DEFAULT_PROVIDER_TYPE
): Promise<string> {
  const key = await getActiveProviderKey(supabase, providerType);
  const model = preferredDefaultModelFromAllowed(key.allowedModels);
  if (!model) {
    throw noActiveProviderKeysError({
      providerType: key.providerType,
      service: key.service,
      reason: 'no_paid_allowed_models',
    });
  }
  return model;
}

export function validateRequestedModel(model: string, allowedModels: string[]): string {
  const requested = normalizeModelId(model);
  if (!requested) {
    throw new ModelRoutingError(400, 'model_not_allowed', 'model_not_allowed', {
      reason: 'missing_model',
    });
  }
  if (isFreeModelId(requested)) {
    throw new ModelRoutingError(400, 'model_not_allowed', 'model_not_allowed', {
      model: requested,
      reason: 'free_tier_models_forbidden',
    });
  }

  const paidAllowed = paidOnly(allowedModels);
  const resolved =
    paidAllowed.find((allowed) => allowed.toLowerCase() === requested.toLowerCase()) || null;
  if (!resolved) {
    throw new ModelRoutingError(400, 'model_not_allowed', 'model_not_allowed', {
      model: requested,
    });
  }

  return resolved;
}

export async function markKeyUsed(supabase: SupabaseClient, service: string): Promise<void> {
  const normalizedService = String(service || '').trim();
  if (!normalizedService) return;
  const nowIso = new Date().toISOString();
  const table = await resolveProviderKeyTableForUpdates(supabase);

  const { error } = await supabase
    .from(table)
    .update({
      last_used_at: nowIso,
      updated_at: nowIso,
    })
    .eq('service', normalizedService);

  if (error) {
    throw new ModelRoutingError(503, 'provider_key_update_failed', error.message, {
      service: normalizedService,
      operation: 'mark_used',
    });
  }
}

export async function markKeyError(
  supabase: SupabaseClient,
  service: string,
  errorInfo?: MarkKeyErrorInput
): Promise<void> {
  const normalizedService = String(service || '').trim();
  if (!normalizedService) return;
  const table = await resolveProviderKeyTableForUpdates(supabase);

  const nowIso = new Date().toISOString();
  let { data, error } = await supabase
    .from(table)
    .select('error_count,is_active,metadata')
    .eq('service', normalizedService)
    .maybeSingle();

  if (error && isMissingColumnError(error)) {
    const fallback = await supabase
      .from(table)
      .select('error_count,is_active')
      .eq('service', normalizedService)
      .maybeSingle();
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error) {
    throw new ModelRoutingError(503, 'provider_key_update_failed', error.message, {
      service: normalizedService,
      operation: 'fetch_before_mark_error',
    });
  }

  if (!data) return;

  const currentErrorCount = Number.isFinite(Number((data as any).error_count))
    ? Number((data as any).error_count)
    : 0;
  const nextErrorCount = currentErrorCount + 1;

  const deactivateAfterErrors = parsePositiveInt(
    process.env.AU_PROVIDER_KEY_DEACTIVATE_AFTER_ERRORS,
    DEFAULT_DEACTIVATE_AFTER_ERRORS
  );

  const metadata = normalizeMetadata((data as any).metadata);
  metadata.last_error_at = nowIso;
  if (Number.isFinite(Number(errorInfo?.status))) {
    metadata.last_error_status = Number(errorInfo?.status);
  }
  if (errorInfo?.code) metadata.last_error_code = String(errorInfo.code);
  if (errorInfo?.message) {
    metadata.last_error_message = String(errorInfo.message).slice(0, 500);
  }

  const patch: Record<string, unknown> = {
    error_count: nextErrorCount,
    metadata,
    updated_at: nowIso,
  };

  if (deactivateAfterErrors > 0 && nextErrorCount >= deactivateAfterErrors) {
    patch.is_active = false;
    metadata.deactivated_at = nowIso;
    metadata.deactivated_reason = 'error_threshold_reached';
  }

  let { error: updateError } = await supabase
    .from(table)
    .update(patch)
    .eq('service', normalizedService);

  if (updateError && isMissingColumnError(updateError)) {
    const fallbackPatch: Record<string, unknown> = { error_count: nextErrorCount };
    if (Object.prototype.hasOwnProperty.call(patch, 'is_active')) {
      fallbackPatch.is_active = patch.is_active;
    }
    const fallbackUpdate = await supabase
      .from(table)
      .update(fallbackPatch)
      .eq('service', normalizedService);
    updateError = fallbackUpdate.error;
  }

  if (updateError) {
    throw new ModelRoutingError(503, 'provider_key_update_failed', updateError.message, {
      service: normalizedService,
      operation: 'mark_error',
    });
  }
}

export async function getAllowedPaidModelsForProvider(
  supabase: SupabaseClient,
  providerType: string = DEFAULT_PROVIDER_TYPE
): Promise<string[]> {
  const keys = await fetchActiveProviderKeys(supabase, providerType);
  if (keys.length === 0) {
    throw noActiveProviderKeysError({
      providerType: String(providerType || DEFAULT_PROVIDER_TYPE).trim().toLowerCase(),
    });
  }

  const union = new Map<string, string>();
  for (const key of keys) {
    for (const model of paidOnly(key.allowedModels)) {
      const normalized = model.toLowerCase();
      if (!union.has(normalized)) {
        union.set(normalized, model);
      }
    }
  }

  const models = sortModelsByPreference(Array.from(union.values()));
  if (models.length === 0) {
    throw noActiveProviderKeysError({
      providerType: String(providerType || DEFAULT_PROVIDER_TYPE).trim().toLowerCase(),
      reason: 'no_paid_allowed_models',
    });
  }

  return models;
}

export async function buildRoutingCandidates(
  input: SelectProviderAndModelInput
): Promise<{ tierWanted: RoutingTier; flags: ModelRoutingFlags; candidates: RoutingCandidate[] }> {
  const { supabase, requestType } = input;
  const providerType = DEFAULT_PROVIDER_TYPE;
  const flags = await getModelRoutingFlags(supabase);
  const keys = await fetchActiveProviderKeys(supabase, providerType);

  if (keys.length === 0) {
    throw noActiveProviderKeysError({ providerType });
  }

  const allowedUnionMap = new Map<string, string>();
  for (const key of keys) {
    for (const model of paidOnly(key.allowedModels)) {
      const normalized = model.toLowerCase();
      if (!allowedUnionMap.has(normalized)) {
        allowedUnionMap.set(normalized, model);
      }
    }
  }
  const allowedUnion = sortModelsByPreference(Array.from(allowedUnionMap.values()));

  const requestedModelRaw = normalizeModelId(input.requestedModel || '');
  const requestedModel = requestedModelRaw
    ? validateRequestedModel(requestedModelRaw, allowedUnion)
    : null;

  const candidates: RoutingCandidate[] = [];
  for (const key of keys) {
    const keyAllowedModels = sortModelsByPreference(paidOnly(key.allowedModels));
    if (keyAllowedModels.length === 0) continue;

    let model = requestedModel;
    if (model) {
      if (!isAllowedModel(model, keyAllowedModels)) continue;
    } else {
      model = preferredDefaultModelFromAllowed(keyAllowedModels);
    }

    if (!model) continue;

    candidates.push({
      service: key.service,
      apiKey: key.keyValue,
      model,
      errorCount: key.errorCount,
      tierWanted: 'pro',
      requestType,
      providerType: key.providerType,
      keyMetadata: key.metadata,
      flags,
    });
  }

  if (candidates.length === 0) {
    if (requestedModel) {
      throw new ModelRoutingError(400, 'model_not_allowed', 'model_not_allowed', {
        model: requestedModel,
      });
    }
    throw noActiveProviderKeysError({
      providerType,
      reason: 'no_paid_allowed_models',
    });
  }

  return {
    tierWanted: 'pro',
    flags,
    candidates,
  };
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
  await markKeyUsed(supabase, candidate.service);
}

export async function noteRoutingFailure(
  supabase: SupabaseClient,
  candidate: RoutingCandidate,
  status: number,
  _retryAfterHeader?: string | null
): Promise<void> {
  if (!shouldIncrementErrorCount(status)) return;
  await markKeyError(supabase, candidate.service, {
    status,
    message: `upstream_status_${status}`,
  });
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
    plan: input.plan || 'unknown',
    tierWanted: input.candidate.tierWanted,
    service: input.candidate.service,
    providerType: input.candidate.providerType,
    model: input.candidate.model,
    paidOnlyMode: input.candidate.flags.paidOnlyMode,
  };
  console.info('[ai-routing]', JSON.stringify(payload));
}
