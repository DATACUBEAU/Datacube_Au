import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getServiceClient } from "./au.ts";

export interface ServicePolicy {
  tier: "free" | "pro";
  allowed_models: string[];
  speed_profile: {
    rpm: number;
    tpm: number;
  };
  upload_limits: {
    textbook_count: number;
    past_question_count: number;
    max_mb: number;
  };
  weekly_rules: {
    enabled: boolean;
    one_doc_per_week: boolean;
    features_once_per_week: boolean;
  };
  max_context_tokens: number;
  embeddings_enabled: boolean;
  premium_features: string[];
}

const FREE_MODEL_SUFFIX = `${String.fromCharCode(58)}free`;
const OPENROUTER_PROVIDER = "openrouter";

function normalizeModelId(value: unknown): string {
  return String(value || "").trim();
}

function isFreeModelId(model: string): boolean {
  return normalizeModelId(model).toLowerCase().endsWith(FREE_MODEL_SUFFIX);
}

function uniqueModels(models: string[]): string[] {
  const out = new Map<string, string>();
  for (const model of models) {
    const normalized = normalizeModelId(model);
    if (!normalized) continue;
    const lowered = normalized.toLowerCase();
    if (!out.has(lowered)) out.set(lowered, normalized);
  }
  return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
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
    if (!isMissingTableLikeError(legacyQuery.error, "au_pro_models_registry")) throw legacyQuery.error;
    return [];
  }

  return uniqueModels(
    (legacyQuery.data || [])
      .map((row: any) => normalizeModelId(row?.model_id))
      .filter((model: string) => model.length > 0 && !isFreeModelId(model)),
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
    if (!isMissingTableLikeError(legacyQuery.error, "au_models_registry")) throw legacyQuery.error;
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
    if (!isMissingTableLikeError(legacyQuery.error, "au_models_registry")) throw legacyQuery.error;
    return [];
  }

  return uniqueModels(
    (legacyQuery.data || [])
      .map((row: any) => normalizeModelId(row?.model_id))
      .filter((model: string) => model.length > 0 && isFreeModelId(model)),
  );
}

async function hasActiveProGrant(supabaseAdmin: SupabaseClient, userId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("entitlement_grants")
    .select("id")
    .eq("user_id", userId)
    .eq("entitlement", "pro")
    .eq("status", "active")
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .limit(1);

  if (error) return false;
  return (data || []).length > 0;
}

async function resolveUserHasPaidEntitlement(
  supabaseAdmin: SupabaseClient,
  userId: string,
  profile: any,
): Promise<boolean> {
  const now = new Date();

  if (profile?.tier === "pro") {
    if (!profile?.tier_expires_at) return true;
    if (new Date(profile.tier_expires_at) > now) return true;
  }

  const { data: sub } = await supabaseAdmin
    .from("au_subscriptions")
    .select("status,current_period_end")
    .eq("owner_id", userId)
    .in("status", ["active", "non_renewing"])
    .gt("current_period_end", now.toISOString())
    .maybeSingle();

  if (sub) return true;
  return await hasActiveProGrant(supabaseAdmin, userId);
}

async function resolveAllowedModels(
  supabaseAdmin: SupabaseClient,
  tier: "free" | "pro",
): Promise<string[]> {
  if (tier === "pro") {
    const pro = await fetchProRegistryModels(supabaseAdmin);
    if (pro.length > 0) return pro;
    return await fetchNonFreeFromBaseRegistry(supabaseAdmin);
  }
  return await fetchFreeRegistryModels(supabaseAdmin);
}

function buildPolicy(tier: "free" | "pro", allowedModels: string[]): ServicePolicy {
  if (tier === "pro") {
    return {
      tier: "pro",
      allowed_models: allowedModels,
      speed_profile: { rpm: 100, tpm: 100000 },
      upload_limits: { textbook_count: -1, past_question_count: -1, max_mb: 1000 },
      weekly_rules: { enabled: false, one_doc_per_week: false, features_once_per_week: false },
      max_context_tokens: 128000,
      embeddings_enabled: true,
      premium_features: ["predictions_pro", "practice_pro", "concept_maps_pro", "rerank_pro"],
    };
  }

  return {
    tier: "free",
    allowed_models: allowedModels,
    speed_profile: { rpm: 10, tpm: 10000 },
    upload_limits: { textbook_count: 5, past_question_count: 10, max_mb: 100 },
    weekly_rules: { enabled: false, one_doc_per_week: false, features_once_per_week: false },
    max_context_tokens: 8192,
    embeddings_enabled: true,
    premium_features: [],
  };
}

export async function getServicePolicy(supabaseClient: SupabaseClient, userId: string): Promise<ServicePolicy> {
  const supabaseAdmin = getServiceClient();

  const [{ data: profile, error: profileError }, { data: conexConfig }, { data: legacyConfig }] = await Promise.all([
    supabaseClient
      .from("au_user_profiles")
      .select("tier,stripe_status,tier_expires_at,billing_source")
      .eq("user_id", userId)
      .single(),
    supabaseAdmin
      .from("au_conex_config")
      .select("billing_enabled,premium_models_enabled,premium_models_paid_only,paid_mode_enabled")
      .eq("id", 1)
      .maybeSingle(),
    supabaseAdmin
      .from("au_config")
      .select("billing_enabled")
      .maybeSingle(),
  ]);

  if (profileError && profileError.code !== "PGRST116") {
    console.error("Error fetching profile for policy:", profileError);
  }

  const billingEnabled = conexConfig?.billing_enabled ?? legacyConfig?.billing_enabled ?? false;
  const premiumModelsEnabled = conexConfig?.premium_models_enabled !== false;
  const premiumModelsPaidOnly = conexConfig?.premium_models_paid_only !== false;
  const paidModeEnabled = conexConfig?.paid_mode_enabled === true;

  let tier: "free" | "pro" = "free";

  if (!premiumModelsEnabled) {
    tier = "free";
  } else if (!premiumModelsPaidOnly) {
    tier = "pro";
  } else if (paidModeEnabled) {
    tier = "pro";
  } else if (!billingEnabled) {
    tier = "pro";
  } else if (profile && userId) {
    const hasPaid = await resolveUserHasPaidEntitlement(supabaseAdmin, userId, profile);
    tier = hasPaid ? "pro" : "free";
  } else {
    tier = "free";
  }

  const allowedModels = await resolveAllowedModels(supabaseAdmin, tier);
  return buildPolicy(tier, allowedModels);
}
