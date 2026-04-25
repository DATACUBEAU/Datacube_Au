/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ConfigService } from "./config_service.ts";

export interface Model {
  id: string;
  tier: 1 | 2 | 3 | 4;
  name: string;
}

export let VERIFIED_FREE_MODELS: Model[] = [];

const PROVIDER_KEY_TABLES = ["au_api_keys", "ai_provider_keys"] as const;
type ProviderKeyTableName = (typeof PROVIDER_KEY_TABLES)[number];
let providerKeyTableCache: ProviderKeyTableName | null = null;

const FREE_MODEL_SUFFIX = `${String.fromCharCode(58)}free`;
const OPENROUTER_PROVIDER = "openrouter";

type ProviderKeyRecord = {
  service: string;
  keyValue: string;
  errorCount: number;
  lastUsedAt: string | null;
  allowedModels: string[];
};

function normalizeModelId(value: unknown): string {
  return String(value || "").trim();
}

function isFreeModelId(value: string): boolean {
  return normalizeModelId(value).toLowerCase().endsWith(FREE_MODEL_SUFFIX);
}

function uniqueModels(models: string[]): string[] {
  const map = new Map<string, string>();
  for (const model of models) {
    const normalized = normalizeModelId(model);
    if (!normalized) continue;
    const lowered = normalized.toLowerCase();
    if (!map.has(lowered)) map.set(lowered, normalized);
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueModels(
      value
        .map((item) => normalizeModelId(item))
        .filter((item) => item.length > 0),
    );
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const raw = value.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        return normalizeStringArray(parsed);
      } catch {
        return [];
      }
    }
    return [raw];
  }

  return [];
}

function isMissingTableLikeError(error: any, table: string): boolean {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  const tableRef = `public.${table}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes(`table '${tableRef}'`) ||
    details.includes(`table '${tableRef}'`) ||
    (message.includes("schema cache") && message.includes(table.toLowerCase())) ||
    (details.includes("schema cache") && details.includes(table.toLowerCase()))
  );
}

function isMissingColumnError(error: any): boolean {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  return (
    code === "42703" ||
    (message.includes("column") && message.includes("does not exist")) ||
    (details.includes("column") && details.includes("does not exist"))
  );
}

function providerKeyTablesInOrder(): Array<(typeof PROVIDER_KEY_TABLES)[number]> {
  if (!providerKeyTableCache) return [...PROVIDER_KEY_TABLES];
  return [providerKeyTableCache, ...PROVIDER_KEY_TABLES.filter((table) => table !== providerKeyTableCache)];
}

function sortKeysByHealthAndRotation(a: ProviderKeyRecord, b: ProviderKeyRecord): number {
  if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;

  const aUsed = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
  const bUsed = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
  if (aUsed !== bUsed) return aUsed - bUsed;

  return a.service.localeCompare(b.service);
}

function toProviderKeyRecord(raw: any): ProviderKeyRecord | null {
  const service = String(raw?.service || "").trim();
  const keyValue = String(raw?.key_value || "").trim();
  if (!service || !keyValue) return null;

  return {
    service,
    keyValue,
    errorCount: Number.isFinite(Number(raw?.error_count)) ? Number(raw?.error_count) : 0,
    lastUsedAt: raw?.last_used_at ? String(raw.last_used_at) : null,
    allowedModels: normalizeStringArray(raw?.allowed_models),
  };
}

async function loadActiveProviderKeys(
  supabaseAdmin: SupabaseClient,
): Promise<{ keys: ProviderKeyRecord[]; table: (typeof PROVIDER_KEY_TABLES)[number] }> {
  let lastError: any = null;

  for (const table of providerKeyTablesInOrder()) {
    const fullQuery = await supabaseAdmin
      .from(table)
      .select("service,key_value,is_active,error_count,last_used_at,provider_type,allowed_models")
      .eq("is_active", true)
      .eq("provider_type", OPENROUTER_PROVIDER)
      .order("error_count", { ascending: true, nullsFirst: true })
      .order("last_used_at", { ascending: true, nullsFirst: true });

    if (!fullQuery.error) {
      providerKeyTableCache = table;
      const keys = (fullQuery.data || [])
        .map((row: any) => toProviderKeyRecord(row))
        .filter((row): row is ProviderKeyRecord => Boolean(row))
        .sort(sortKeysByHealthAndRotation);
      return { keys, table };
    }

    if (!isMissingColumnError(fullQuery.error) && !isMissingTableLikeError(fullQuery.error, table)) {
      lastError = fullQuery.error;
      continue;
    }

    const legacyQuery = await supabaseAdmin
      .from(table)
      .select("service,key_value,is_active,error_count,last_used_at,allowed_models")
      .eq("is_active", true)
      .order("error_count", { ascending: true, nullsFirst: true })
      .order("last_used_at", { ascending: true, nullsFirst: true });

    if (!legacyQuery.error) {
      providerKeyTableCache = table;
      const keys = (legacyQuery.data || [])
        .map((row: any) => toProviderKeyRecord(row))
        .filter((row): row is ProviderKeyRecord => Boolean(row))
        .sort(sortKeysByHealthAndRotation);
      return { keys, table };
    }

    if (!isMissingTableLikeError(legacyQuery.error, table)) {
      lastError = legacyQuery.error;
    } else {
      lastError = legacyQuery.error;
    }
  }

  if (lastError) {
    throw new Error(`Provider key lookup failed: ${String(lastError.message || lastError)}`);
  }
  throw new Error("No provider key table available.");
}

function shouldUseProRegistry(config: any, requestedTier: "free" | "pro"): boolean {
  const billingEnabled = config?.billing_enabled === true;
  const premiumModelsEnabled = config?.premium_models_enabled !== false;
  const premiumModelsPaidOnly = config?.premium_models_paid_only !== false;
  const paidModeEnabled = config?.paid_mode_enabled === true;

  if (!premiumModelsEnabled) return false;
  if (!premiumModelsPaidOnly) return true;
  if (!billingEnabled || paidModeEnabled) return true;
  return requestedTier === "pro";
}

async function resolveEffectiveTier(
  supabaseAdmin: SupabaseClient,
  requestedTier: "free" | "pro",
): Promise<"free" | "pro"> {
  const { data: config, error } = await supabaseAdmin
    .from("au_conex_config")
    .select("billing_enabled,premium_models_enabled,premium_models_paid_only,paid_mode_enabled")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.warn(`[ModelRegistry] Failed to read au_conex_config: ${error.message}`);
  }

  return shouldUseProRegistry(config, requestedTier) ? "pro" : "free";
}

async function fetchProRegistryModels(supabaseAdmin: SupabaseClient): Promise<string[]> {
  const fullQuery = await supabaseAdmin
    .from("au_pro_models_registry")
    .select("model_id,is_active,provider")
    .eq("is_active", true)
    .eq("provider", OPENROUTER_PROVIDER)
    .order("model_id", { ascending: true });

  if (!fullQuery.error) {
    return uniqueModels(
      (fullQuery.data || [])
        .map((row: any) => normalizeModelId(row?.model_id))
        .filter((model: string) => model.length > 0 && !isFreeModelId(model)),
    );
  }

  if (!isMissingColumnError(fullQuery.error) && !isMissingTableLikeError(fullQuery.error, "au_pro_models_registry")) {
    throw fullQuery.error;
  }

  const legacyQuery = await supabaseAdmin
    .from("au_pro_models_registry")
    .select("model_id,is_active")
    .eq("is_active", true)
    .order("model_id", { ascending: true });

  if (legacyQuery.error) {
    if (!isMissingTableLikeError(legacyQuery.error, "au_pro_models_registry")) {
      throw legacyQuery.error;
    }
    return [];
  }

  return uniqueModels(
    (legacyQuery.data || [])
      .map((row: any) => normalizeModelId(row?.model_id))
      .filter((model: string) => model.length > 0 && !isFreeModelId(model)),
  );
}

async function fetchFreeRegistryModels(supabaseAdmin: SupabaseClient): Promise<string[]> {
  const fullQuery = await supabaseAdmin
    .from("au_models_registry")
    .select("model_id,is_active,is_free,provider,type")
    .eq("is_active", true)
    .eq("is_free", true)
    .eq("provider", OPENROUTER_PROVIDER)
    .eq("type", "chat")
    .order("model_id", { ascending: true });

  if (!fullQuery.error) {
    return uniqueModels(
      (fullQuery.data || [])
        .map((row: any) => normalizeModelId(row?.model_id))
        .filter((model: string) => model.length > 0 && isFreeModelId(model)),
    );
  }

  if (!isMissingColumnError(fullQuery.error) && !isMissingTableLikeError(fullQuery.error, "au_models_registry")) {
    throw fullQuery.error;
  }

  const legacyQuery = await supabaseAdmin
    .from("au_models_registry")
    .select("model_id,is_active")
    .eq("is_active", true)
    .order("model_id", { ascending: true });

  if (legacyQuery.error) {
    if (!isMissingTableLikeError(legacyQuery.error, "au_models_registry")) {
      throw legacyQuery.error;
    }
    return [];
  }

  return uniqueModels(
    (legacyQuery.data || [])
      .map((row: any) => normalizeModelId(row?.model_id))
      .filter((model: string) => model.length > 0 && isFreeModelId(model)),
  );
}

async function fetchNonFreeFromBaseRegistry(supabaseAdmin: SupabaseClient): Promise<string[]> {
  const fullQuery = await supabaseAdmin
    .from("au_models_registry")
    .select("model_id,is_active,is_free,provider,type")
    .eq("is_active", true)
    .eq("is_free", false)
    .eq("provider", OPENROUTER_PROVIDER)
    .eq("type", "chat")
    .order("model_id", { ascending: true });

  if (!fullQuery.error) {
    return uniqueModels(
      (fullQuery.data || [])
        .map((row: any) => normalizeModelId(row?.model_id))
        .filter((model: string) => model.length > 0 && !isFreeModelId(model)),
    );
  }

  if (!isMissingColumnError(fullQuery.error) && !isMissingTableLikeError(fullQuery.error, "au_models_registry")) {
    throw fullQuery.error;
  }

  const legacyQuery = await supabaseAdmin
    .from("au_models_registry")
    .select("model_id,is_active")
    .eq("is_active", true)
    .order("model_id", { ascending: true });

  if (legacyQuery.error) {
    if (!isMissingTableLikeError(legacyQuery.error, "au_models_registry")) {
      throw legacyQuery.error;
    }
    return [];
  }

  return uniqueModels(
    (legacyQuery.data || [])
      .map((row: any) => normalizeModelId(row?.model_id))
      .filter((model: string) => model.length > 0 && !isFreeModelId(model)),
  );
}

async function resolveCandidateModelsForTier(
  supabaseAdmin: SupabaseClient,
  tier: "free" | "pro",
  exclude: string[],
): Promise<string[]> {
  const excluded = new Set(exclude.map((id) => normalizeModelId(id).toLowerCase()).filter(Boolean));
  let models: string[] = [];

  if (tier === "pro") {
    models = await fetchProRegistryModels(supabaseAdmin);
    if (models.length === 0) {
      models = await fetchNonFreeFromBaseRegistry(supabaseAdmin);
    }
  } else {
    models = await fetchFreeRegistryModels(supabaseAdmin);
  }

  models = models.filter((model) => !excluded.has(model.toLowerCase()));
  return uniqueModels(models);
}

function applyKeyAllowedModelRestriction(
  keyAllowedModels: string[],
  candidates: string[],
  tier: "free" | "pro",
): string[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const normalizedAllowed = normalizeStringArray(keyAllowedModels);
  if (normalizedAllowed.length === 0) return [...candidates];

  const allowedSet = new Set(
    normalizedAllowed
      .filter((model) => (tier === "pro" ? !isFreeModelId(model) : isFreeModelId(model)))
      .map((model) => model.toLowerCase()),
  );

  if (allowedSet.size === 0) return [];
  return candidates.filter((model) => allowedSet.has(model.toLowerCase()));
}

/**
 * Syncs the local free registry cache with DB.
 */
export async function syncRegistry(supabaseAdmin: SupabaseClient) {
  try {
    const models = await fetchFreeRegistryModels(supabaseAdmin);
    VERIFIED_FREE_MODELS = models.map((modelId, idx) => ({
      id: modelId,
      tier: (idx === 0 ? 1 : idx <= 5 ? 2 : 3) as 1 | 2 | 3 | 4,
      name: modelId,
    }));
    console.log(`[ModelRegistry] Synced ${VERIFIED_FREE_MODELS.length} free models from DB.`);
  } catch (err) {
    console.warn(`[ModelRegistry] Failed to sync from DB:`, (err as Error).message);
  }
}

/**
 * Returns the best model/key configuration from Supabase tables only.
 */
export async function getAURequestConfig(
  supabaseAdmin: SupabaseClient,
  exclude: string[] = [],
  _scope = "chat",
  tier: "free" | "pro" = "free",
): Promise<{ modelId: string; apiKey: string }> {
  const { keys, table: providerKeyTable } = await loadActiveProviderKeys(supabaseAdmin);
  if (!keys || keys.length === 0) {
    throw new Error("No active API keys found in provider table.");
  }

  const effectiveTier = await resolveEffectiveTier(supabaseAdmin, tier);
  let candidateModels = await resolveCandidateModelsForTier(supabaseAdmin, effectiveTier, exclude);

  if (candidateModels.length === 0 && effectiveTier === "pro") {
    console.warn("[ModelRegistry] No pro models resolved; falling back to free registry.");
    candidateModels = await resolveCandidateModelsForTier(supabaseAdmin, "free", exclude);
  }

  if (candidateModels.length === 0) {
    throw new Error(`No active models configured in Supabase registry for tier ${effectiveTier}.`);
  }

  for (const key of keys) {
    const possibleModels = applyKeyAllowedModelRestriction(key.allowedModels, candidateModels, effectiveTier);
    if (possibleModels.length === 0) continue;

    const selectedModelId = possibleModels[0];
    await supabaseAdmin
      .from(providerKeyTable)
      .update({ last_used_at: new Date().toISOString() })
      .eq("service", key.service);

    console.log(`[ModelRegistry] Selected model=${selectedModelId} service=${key.service} tier=${effectiveTier}`);
    return { modelId: selectedModelId, apiKey: key.keyValue };
  }

  throw new Error(`No valid key/model pair found for tier ${effectiveTier}. Check allowed_models constraints.`);
}

/**
 * Simple key rotation for embeddings.
 */
export async function getRotatingApiKey(supabaseAdmin: SupabaseClient): Promise<string> {
  const configService = ConfigService.getInstance(supabaseAdmin);
  return configService.getRotatedKey(OPENROUTER_PROVIDER);
}

export function getVerifiedModelIds() {
  return VERIFIED_FREE_MODELS.map((m) => m.id);
}

export function reportModelHealth(modelId: string, success: boolean, status?: number, scope = "chat") {
  if (!success) {
    console.warn(`[ModelRegistry][${scope}] Model ${modelId} reported error: ${status}`);
  }
}

export async function reportKeyHealth(
  supabaseAdmin: SupabaseClient,
  apiKey: string,
  success: boolean,
  status?: number,
) {
  if (!success && (status === 401 || status === 403)) {
    const configService = ConfigService.getInstance(supabaseAdmin);
    await configService.reportKeyFailure(apiKey);
  } else if (!success && status === 429) {
    console.warn("[ModelRegistry] Skipping key failure increment for throttling status 429.");
  }
}
