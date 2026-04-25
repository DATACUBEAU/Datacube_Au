/// <reference path="../deno.d.ts" />
import { getCorsHeaders, getServiceClient } from "../_shared/au.ts";
import { checkAdminLockOrThrow, recordAdminAttempt } from "../_shared/admin_lockout.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const ADMIN_BLOCK_DAYS = 7; // Legacy
const MAX_ATTEMPTS = 3; // Legacy logic, superseded by shared lockout
const MAX_ATTEMPTS_SOFT = 3;
const MAX_ATTEMPTS_HARD = 6;
const LOCKOUT_MS_SOFT = 10 * 60 * 1000;
const LOCKOUT_MS_HARD = 24 * 60 * 60 * 1000;
const CONEX_ROOT_ADMIN_USER_ID = "05ad2f16-b3ce-48eb-bf24-41b407556ffd";
const CONEX_ROOT_ADMIN_EMAIL = "fabiansazzy1214@gmail.com";
const CONEX_ROOT_ADMIN_EMAIL_FALLBACK = "fabiansazzy121@gmail.com";

class HttpError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function requireSupabaseUserSession(req: Request): Promise<{ id: string; email: string | null }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new HttpError(401, "Unauthorized: Bearer token required");
  }

  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : authHeader.trim();

  if (!token || token === "undefined" || token === "null") {
    throw new HttpError(401, "Unauthorized: Invalid bearer token");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("MY_SUPABASE_URL") ?? "";
  const supabaseAnonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
    req.headers.get("apikey") ??
    "";
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new HttpError(500, "Server configuration error: missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
  if (error || !user?.id) {
    throw new HttpError(401, "Unauthorized: Invalid or expired access token");
  }

  return { id: user.id, email: user.email ?? null };
}

function hasConexAccess(userId: string, email: string | null | undefined, tier: unknown): boolean {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const isRootAdmin =
    userId === CONEX_ROOT_ADMIN_USER_ID ||
    normalizedEmail === CONEX_ROOT_ADMIN_EMAIL ||
    normalizedEmail === CONEX_ROOT_ADMIN_EMAIL_FALLBACK;

  if (isRootAdmin) return true;
  return String(tier ?? "").trim().toLowerCase() === "admin";
}

type FeatureFlagDef = {
  key: string;
  defaultValue: boolean;
  description: string;
  mirrorConfigKey?: string;
};

const REQUIRED_FEATURE_FLAGS: FeatureFlagDef[] = [
  {
    key: "global_chat_enabled",
    defaultValue: true,
    description: "Enable Global Chat across the app.",
    mirrorConfigKey: "global_chat_enabled",
  },
  {
    key: "promo_enabled",
    defaultValue: false,
    description: "Promo mode switch. When enabled, billing is forced off.",
  },
  {
    key: "premium_models_enabled",
    defaultValue: true,
    description: "Master switch for premium model availability.",
    mirrorConfigKey: "premium_models_enabled",
  },
  {
    key: "premium_models_paid_only",
    defaultValue: true,
    description: "When enabled, only paid users can access premium models.",
    mirrorConfigKey: "premium_models_paid_only",
  },
  {
    key: "billing_enabled",
    defaultValue: false,
    description: "Master billing/monetization toggle.",
    mirrorConfigKey: "billing_enabled",
  },
  {
    key: "stripe_live_mode",
    defaultValue: false,
    description: "Use Stripe live mode pricing/behavior.",
    mirrorConfigKey: "stripe_live_mode",
  },
  {
    key: "paid_mode_enabled",
    defaultValue: false,
    description: "Force paid key path for model calls.",
    mirrorConfigKey: "paid_mode_enabled",
  },
  {
    key: "limits.alerts.enabled",
    defaultValue: true,
    description: "Enable context-aware limits alerts in the UI.",
  },
  {
    key: "limits.alerts.thresholds",
    defaultValue: true,
    description: "Threshold config for limits alerts.",
  },
  {
    key: "limits.alerts.cooldown_minutes",
    defaultValue: true,
    description: "Cooldown window for repeated limits alerts.",
  },
  {
    key: "limits.enforcement.enabled",
    defaultValue: true,
    description: "Enable server-side limits enforcement.",
  },
  {
    key: "limits.ui.upsell.enabled",
    defaultValue: true,
    description: "Enable upsell CTAs in limits alerts.",
  },
  {
    key: "retention.enforcement.enabled",
    defaultValue: true,
    description: "Enable retention cleanup enforcement.",
  },
  {
    key: "auth.reauth_modal.enabled",
    defaultValue: true,
    description: "Enable session-expired re-auth modal UX.",
  },
];

const MIRRORED_FLAG_KEYS = new Set(
  REQUIRED_FEATURE_FLAGS.filter((d) => !!d.mirrorConfigKey).map((d) => d.key),
);

const LIVE_ACTIVITY_WINDOW_MINUTES = 15;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const DEFAULT_FREE_REGISTRY_MODELS: Array<Record<string, unknown>> = [];
const DEFAULT_PRO_REGISTRY_MODELS: Array<Record<string, unknown>> = [];

const DEFAULT_ALERT_EVENT_TYPES = [
  "admin_login_failed",
  "critical_error",
  "billing_failure",
  "api_key_exhausted",
];

function errorCode(error: any): string {
  return String(error?.code ?? "").trim();
}

function errorMessage(error: any): string {
  return String(error?.message ?? "").toLowerCase();
}

function isMissingTableLikeError(error: any): boolean {
  const code = errorCode(error);
  const message = errorMessage(error);
  return (
    code === "42P01" ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

function isMissingColumnError(error: any): boolean {
  const code = errorCode(error);
  const message = errorMessage(error);
  return code === "42703" || (message.includes("column") && message.includes("does not exist"));
}

function isMissingFunctionError(error: any): boolean {
  const code = errorCode(error);
  const message = errorMessage(error);
  return code === "42883" || (message.includes("function") && message.includes("does not exist"));
}

function normalizeRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const entry of value) {
    const normalized = String(entry ?? "").trim().toLowerCase();
    if (!normalized) continue;
    unique.add(normalized);
  }
  return [...unique];
}

function buildDefaultAlertConfigs() {
  const seedRecipients = [CONEX_ROOT_ADMIN_EMAIL, CONEX_ROOT_ADMIN_EMAIL_FALLBACK]
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);

  return DEFAULT_ALERT_EVENT_TYPES.map((eventType) => ({
    event_type: eventType,
    recipients: [...new Set(seedRecipients)],
    is_enabled: eventType === "critical_error" || eventType === "admin_login_failed",
    updated_at: new Date().toISOString(),
  }));
}

function inferUsageFailure(row: any): boolean {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const status = String((metadata as any)?.status ?? "").toLowerCase();
  const hasErrorField =
    (metadata as any)?.error != null ||
    (metadata as any)?.last_error != null ||
    (metadata as any)?.provider_error != null;
  return hasErrorField || status === "failed" || status === "error";
}

function mapEventsToUsage(events: any[]): any[] {
  return (events || []).map((event: any) => {
    const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const usage = metadata?.usage && typeof metadata.usage === "object" ? metadata.usage : {};
    const totalTokens =
      Number(usage?.total_tokens) ||
      Number(metadata?.total_tokens) ||
      Number(metadata?.token_usage) ||
      Number(metadata?.tokens) ||
      0;

    const modelId =
      String(
        metadata?.model_id ||
        metadata?.model ||
        metadata?.provider_model ||
        "unknown",
      );

    return {
      id: event?.id || crypto.randomUUID(),
      user_id: event?.user_id || null,
      feature: String(event?.event_type || "event"),
      model_id: modelId,
      prompt_tokens: Number(usage?.prompt_tokens) || null,
      completion_tokens: Number(usage?.completion_tokens) || null,
      total_tokens: totalTokens,
      metadata,
      created_at: event?.timestamp || event?.created_at || new Date().toISOString(),
    };
  });
}

function formatStorageSizeFromBytes(bytes: number): string {
  const normalized = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (normalized >= 1024 * 1024 * 1024) {
    return `${(normalized / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(normalized / (1024 * 1024)).toFixed(2)} MB`;
}

async function safeTableCount(supabaseAdmin: any, table: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    if (isMissingTableLikeError(error)) return 0;
    throw error;
  }
  return Number(count || 0);
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeConexConfigPayload(config: any): Record<string, unknown> {
  const incoming = config && typeof config === "object" ? { ...config } : {};
  const normalized: Record<string, unknown> = { ...incoming };

  // Keep legacy Stripe field names as canonical DB keys.
  const hasWeeklyField =
    Object.prototype.hasOwnProperty.call(incoming, "stripe_price_weekly") ||
    Object.prototype.hasOwnProperty.call(incoming, "stripe_price_weekly_id");
  const hasMonthlyField =
    Object.prototype.hasOwnProperty.call(incoming, "stripe_price_monthly") ||
    Object.prototype.hasOwnProperty.call(incoming, "stripe_price_monthly_id");

  if (hasWeeklyField) {
    const stripeWeekly =
      normalizeOptionalString(incoming.stripe_price_weekly) ??
      normalizeOptionalString(incoming.stripe_price_weekly_id);
    normalized.stripe_price_weekly = stripeWeekly;
  }
  if (hasMonthlyField) {
    const stripeMonthly =
      normalizeOptionalString(incoming.stripe_price_monthly) ??
      normalizeOptionalString(incoming.stripe_price_monthly_id);
    normalized.stripe_price_monthly = stripeMonthly;
  }

  normalized.global_chat_enabled = asBoolean(incoming.global_chat_enabled, true);
  normalized.premium_models_enabled = asBoolean(incoming.premium_models_enabled, true);
  normalized.premium_models_paid_only = asBoolean(incoming.premium_models_paid_only, true);
  normalized.billing_enabled = asBoolean(incoming.billing_enabled, false);
  normalized.stripe_live_mode = asBoolean(incoming.stripe_live_mode, false);
  normalized.paid_mode_enabled = asBoolean(incoming.paid_mode_enabled, false);
  normalized.updated_at = new Date().toISOString();

  return normalized;
}

function conexConfigDefaults() {
  return {
    billing_enabled: false,
    global_chat_enabled: true,
    premium_models_enabled: true,
    premium_models_paid_only: true,
    stripe_live_mode: false,
    paid_mode_enabled: false,
    stripe_price_weekly: null,
    stripe_price_monthly: null,
  };
}

async function safeInsertDebugLog(supabaseAdmin: any, message: string, details: Record<string, unknown> = {}) {
  try {
    await supabaseAdmin.from("au_debug_logs").insert({
      level: "info",
      source: "admin-handler",
      message,
      details,
    });
  } catch {
  }
}

async function getConexConfigSafe(supabaseAdmin: any) {
  const defaults = conexConfigDefaults();
  const { data, error } = await supabaseAdmin
    .from("au_conex_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return defaults;
  }
  return { ...defaults, ...(data || {}) };
}

function normalizePrimaryFeatureFlagRow(row: any) {
  const key = String(row?.key || "").trim();
  if (!key) return null;
  return {
    key,
    enabled: row?.enabled === true,
    category: String(row?.category || "billing"),
    description: String(row?.description || ""),
    scope: ["global", "org", "user"].includes(String(row?.scope || "").toLowerCase())
      ? String(row.scope).toLowerCase()
      : "global",
    config: row?.config && typeof row.config === "object" ? row.config : {},
    updated_at: row?.updated_at || new Date().toISOString(),
  };
}

function normalizeLegacyFeatureFlagRow(row: any) {
  const key = String(row?.key || "").trim();
  if (!key) return null;
  return {
    key,
    enabled: row?.is_enabled === true,
    category: "billing",
    description: String(row?.description || ""),
    scope: "global",
    config: row?.value_json && typeof row.value_json === "object" ? row.value_json : {},
    updated_at: row?.updated_at || new Date().toISOString(),
  };
}

async function fetchFeatureFlagsPortable(supabaseAdmin: any): Promise<{
  flags: any[];
  source: "feature_flags" | "au_feature_flags" | "missing";
}> {
  const primary = await supabaseAdmin
    .from("feature_flags")
    .select("*")
    .order("key", { ascending: true });

  if (!primary.error) {
    const flags = (primary.data || [])
      .map((row: any) => normalizePrimaryFeatureFlagRow(row))
      .filter((row: any) => !!row);
    return { flags, source: "feature_flags" };
  }

  if (!isMissingTableLikeError(primary.error) && !isMissingColumnError(primary.error)) {
    throw primary.error;
  }

  const legacy = await supabaseAdmin
    .from("au_feature_flags")
    .select("*")
    .order("key", { ascending: true });

  if (legacy.error) {
    if (isMissingTableLikeError(legacy.error) || isMissingColumnError(legacy.error)) {
      return { flags: [], source: "missing" };
    }
    throw legacy.error;
  }

  const flags = (legacy.data || [])
    .map((row: any) => normalizeLegacyFeatureFlagRow(row))
    .filter((row: any) => !!row);
  return { flags, source: "au_feature_flags" };
}

async function upsertFeatureFlagsPortable(supabaseAdmin: any, rows: any[]): Promise<"feature_flags" | "au_feature_flags"> {
  if (!Array.isArray(rows) || rows.length === 0) return "feature_flags";

  const normalizedRows = rows.map((row: any) => ({
    key: String(row?.key || "").trim(),
    enabled: row?.enabled === true,
    category: String(row?.category || "billing"),
    description: String(row?.description || ""),
    scope: ["global", "org", "user"].includes(String(row?.scope || "").toLowerCase())
      ? String(row.scope).toLowerCase()
      : "global",
    config: row?.config && typeof row.config === "object" ? row.config : {},
  })).filter((row: any) => row.key.length > 0);

  if (normalizedRows.length === 0) return "feature_flags";

  const primaryUpsert = await supabaseAdmin
    .from("feature_flags")
    .upsert(normalizedRows, { onConflict: "key" });

  if (!primaryUpsert.error) {
    return "feature_flags";
  }

  if (!isMissingTableLikeError(primaryUpsert.error) && !isMissingColumnError(primaryUpsert.error)) {
    throw primaryUpsert.error;
  }

  const legacyRows = normalizedRows.map((row: any) => ({
    key: row.key,
    is_enabled: row.enabled,
    description: row.description,
    value_json: row.config,
    updated_at: new Date().toISOString(),
  }));

  let legacyUpsert = await supabaseAdmin
    .from("au_feature_flags")
    .upsert(legacyRows, { onConflict: "key" });

  if (legacyUpsert.error && isMissingColumnError(legacyUpsert.error)) {
    legacyUpsert = await supabaseAdmin
      .from("au_feature_flags")
      .upsert(
        legacyRows.map((row: any) => ({
          key: row.key,
          is_enabled: row.is_enabled,
          description: row.description,
        })),
        { onConflict: "key" },
      );
  }

  if (legacyUpsert.error) {
    throw legacyUpsert.error;
  }

  return "au_feature_flags";
}

async function ensureFeatureFlags(supabaseAdmin: any, context: { requestId: string; reason: string }) {
  const definitions = REQUIRED_FEATURE_FLAGS;

  const existingPayload = await fetchFeatureFlagsPortable(supabaseAdmin);
  if (existingPayload.source === "missing") {
    await safeInsertDebugLog(supabaseAdmin, "Feature flag tables missing", {
      requestId: context.requestId,
      reason: context.reason,
    });
    return { flags: [] as any[], added: [] as string[], tableMissing: true };
  }

  const config = await getConexConfigSafe(supabaseAdmin);
  const existingMap = new Map((existingPayload.flags || []).map((row: any) => [String(row.key), row]));
  const missingRows: any[] = [];

  for (const def of definitions) {
    if (existingMap.has(def.key)) continue;
    const seededValue = def.mirrorConfigKey
      ? asBoolean((config as any)?.[def.mirrorConfigKey], def.defaultValue)
      : def.defaultValue;
    missingRows.push({
      key: def.key,
      enabled: seededValue,
      category: "billing",
      description: def.description,
      scope: "global",
      config: {},
      updated_at: new Date().toISOString(),
    });
  }

  if (missingRows.length > 0) {
    const writeSource = await upsertFeatureFlagsPortable(supabaseAdmin, missingRows);

    await safeInsertDebugLog(supabaseAdmin, "Feature flags auto-healed", {
      requestId: context.requestId,
      reason: context.reason,
      added: missingRows.map((row) => row.key),
      source: writeSource,
    });
  }

  const finalPayload = await fetchFeatureFlagsPortable(supabaseAdmin);
  if (finalPayload.source === "missing") {
    return {
      flags: [] as any[],
      added: missingRows.map((row) => row.key as string),
      tableMissing: true,
    };
  }

  return {
    flags: finalPayload.flags || [],
    added: missingRows.map((row) => row.key as string),
    tableMissing: false,
  };
}

async function syncConexConfigToFeatureFlags(supabaseAdmin: any, config: Record<string, unknown>, reason: string) {
  const rows = REQUIRED_FEATURE_FLAGS
    .filter((def) => !!def.mirrorConfigKey)
    .map((def) => ({
      key: def.key,
      enabled: asBoolean(config[def.mirrorConfigKey!], def.defaultValue),
      category: "billing",
      description: def.description,
      scope: "global",
      config: {},
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return;

  try {
    await upsertFeatureFlagsPortable(supabaseAdmin, rows);
  } catch (error: any) {
    if (isMissingTableLikeError(error) || isMissingColumnError(error)) return;
    throw error;
  }

  await safeInsertDebugLog(supabaseAdmin, "Conex config mirrored to feature flags", {
    reason,
    keys: rows.map((row) => row.key),
  });
}

async function syncFlagToConexConfigAndLegacy(
  supabaseAdmin: any,
  key: string,
  isEnabled: boolean,
): Promise<void> {
  const def = REQUIRED_FEATURE_FLAGS.find((item) => item.key === key);
  if (!def?.mirrorConfigKey) return;

  const patch: Record<string, unknown> = {
    id: 1,
    [def.mirrorConfigKey]: isEnabled,
    updated_at: new Date().toISOString(),
  };

  const { error: conexError } = await supabaseAdmin
    .from("au_conex_config")
    .upsert(patch)
    .select()
    .maybeSingle();
  if (conexError) throw conexError;

  if (def.mirrorConfigKey === "billing_enabled") {
    const { data: existing } = await supabaseAdmin
      .from("au_config")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("au_config")
        .update({ billing_enabled: isEnabled, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("au_config")
        .insert([{ billing_enabled: isEnabled, updated_at: new Date().toISOString() }]);
      if (insertError) throw insertError;
    }
  }
}

function normalizePaymentStatus(rawStatus: unknown): "pending" | "confirmed" | "rejected" {
  const status = String(rawStatus ?? "").trim().toLowerCase();
  if (["confirmed", "success", "succeeded", "active", "paid", "done"].includes(status)) {
    return "confirmed";
  }
  if (["rejected", "failed", "failure", "error", "canceled", "cancelled"].includes(status)) {
    return "rejected";
  }
  return "pending";
}

function extractPaymentUserId(payment: any): string | null {
  const ownerId = typeof payment?.owner_id === "string" ? payment.owner_id.trim() : "";
  if (ownerId) return ownerId;
  const userId = typeof payment?.user_id === "string" ? payment.user_id.trim() : "";
  if (userId) return userId;
  return null;
}

function extractPaymentReference(payment: any): string {
  const candidates = [payment?.reference, payment?.provider_ref, payment?.reference_code];
  for (const entry of candidates) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      return entry.trim();
    }
  }
  return "";
}

function extractPaymentAmount(payment: any): number {
  const candidates = [payment?.amount_ngn, payment?.amount, payment?.value];
  for (const entry of candidates) {
    const parsed = Number(entry);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function isManualPaymentRow(payment: any): boolean {
  const provider = String(payment?.provider || "").toLowerCase();
  const channel = String(payment?.channel || "").toLowerCase();
  return provider === "manual" || channel === "bank_transfer";
}

function isCardPaymentRow(payment: any): boolean {
  const provider = String(payment?.provider || "").toLowerCase();
  const channel = String(payment?.channel || "").toLowerCase();
  if (provider === "stripe") return true;
  if (provider === "paystack") return channel !== "bank_transfer";
  return false;
}

async function buildPaymentUserMaps(supabaseAdmin: any, userIds: string[]) {
  const usersMap: Record<string, any> = {};
  const profilesMap: Record<string, any> = {};
  if (userIds.length === 0) {
    return { usersMap, profilesMap };
  }

  try {
    const authUsersResponse = await supabaseAdmin.auth.admin.listUsers();
    const authUsers = Array.isArray((authUsersResponse as any)?.data?.users)
      ? (authUsersResponse as any).data.users
      : (Array.isArray((authUsersResponse as any)?.users) ? (authUsersResponse as any).users : []);
    for (const authUser of authUsers || []) {
      if (!authUser?.id) continue;
      usersMap[String(authUser.id)] = authUser;
    }
  } catch (authError) {
    console.warn("[admin-handler] Failed to list auth users for payment enrichment", authError);
  }

  const { data: profiles } = await supabaseAdmin
    .from("au_user_profiles")
    .select("user_id, full_name")
    .in("user_id", userIds);
  for (const profile of profiles || []) {
    if (!profile?.user_id) continue;
    profilesMap[String(profile.user_id)] = profile;
  }

  return { usersMap, profilesMap };
}

async function listAuthUsersWithFallback(
  supabaseAdmin: any,
  adminToken: string,
  opts?: { q?: string; page?: number; pageSize?: number }
): Promise<{ users: any[]; total: number | null }> {
  const page = Math.max(1, Number(opts?.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(opts?.pageSize ?? 50) || 50));
  const q = typeof opts?.q === "string" ? opts!.q : "";

  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: pageSize });
    if (error) throw error;
    const total = typeof (data as any)?.total === "number" ? (data as any).total : null;
    return { users: data?.users || [], total };
  } catch (primaryErr: any) {
    const { data, error } = await supabaseAdmin.rpc("admin_list_auth_users", {
      p_admin_token: adminToken,
      p_q: q || null,
      p_page: page,
      p_page_size: pageSize,
    });

    if (error) {
      throw new HttpError(500, "Unable to list auth users", {
        primary: primaryErr?.message || String(primaryErr),
        fallback: error.message || String(error),
      });
    }

    const payload = data && typeof data === "string" ? JSON.parse(data) : data;
    const users = Array.isArray(payload?.users)
      ? payload.users.map((u: any) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          user_metadata: {
            full_name: u.full_name,
            name: u.full_name,
          },
        }))
      : [];

    const total = typeof payload?.total === "number" ? payload.total : users.length;
    return { users, total };
  }
}

async function countAuthUsersWithFallback(supabaseAdmin: any, adminToken: string): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw error;
    if (typeof (data as any)?.total === "number") return (data as any).total;
    return Array.isArray(data?.users) ? data.users.length : 0;
  } catch (primaryErr: any) {
    const { data, error } = await supabaseAdmin.rpc("admin_count_auth_users", { p_admin_token: adminToken });
    if (error) {
      throw new HttpError(500, "Unable to count auth users", {
        primary: primaryErr?.message || String(primaryErr),
        fallback: error.message || String(error),
      });
    }
    return Number(data || 0);
  }
}

async function logSecurityEvent(
  supabaseAdmin: any,
  eventType: string,
  severity: "info" | "warning" | "critical",
  details: any
) {
  try {
    const ipAddress = details?.ip ?? details?.ip_address ?? null;
    const ownerId = details?.owner_id ?? details?.ownerId ?? null;

    await supabaseAdmin.from("au_security_events").insert([
      {
        event_type: eventType,
        severity,
        ip_address: ipAddress,
        owner_id: ownerId,
        metadata: details ?? {},
      },
    ]);
  } catch (e) {
    console.error("[admin-handler] Failed to log security event:", e);
  }
}

async function triggerEmailAlert(supabaseAdmin: any, eventType: string, details: any) {
  // Also log to security table
  await logSecurityEvent(supabaseAdmin, eventType, 'warning', details);

  try {
    const { data: config } = await supabaseAdmin
      .from("au_admin_email_alerts")
      .select("*")
      .eq("event_type", eventType)
      .eq("is_enabled", true)
      .maybeSingle();

    if (!config || !config.recipients || config.recipients.length === 0) return;

    console.log(`[EmailAlert] Triggering alert for ${eventType} to ${config.recipients.join(", ")}`);
    console.log(`[EmailAlert] Details:`, details);

    // TODO: Integrate with SendGrid, Resend, or SMTP
    // Example fetch to Resend:
    /*
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "AU System <alerts@datacube.au>",
        to: config.recipients,
        subject: `[AU ALERT] ${eventType.replace(/_/g, " ").toUpperCase()}`,
        text: `Event: ${eventType}\nTime: ${new Date().toISOString()}\nDetails: ${JSON.stringify(details, null, 2)}`
      })
    });
    */
  } catch (err) {
    console.error(`[EmailAlert] Failed to trigger alert:`, err);
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseAdmin = getServiceClient();

  let body: any = {};

  try {
    try {
        body = await req.json();
    } catch (e) {
        throw new HttpError(400, "Invalid JSON body. Please ensure valid JSON format.");
    }
    
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Invalid request body. Expected a JSON object.");
    }

    const { action, step, answer, accessKey, sessionId } = body;
    if (typeof action !== "string" || action.trim().length === 0) {
      throw new HttpError(400, "Missing required field: action");
    }

    const sessionUser = await requireSupabaseUserSession(req);

    const { data: userProfile, error: userProfileError } = await supabaseAdmin
      .from("au_user_profiles")
      .select("tier")
      .eq("user_id", sessionUser.id)
      .maybeSingle();

    if (userProfileError) {
      console.error("[admin-handler] Failed to load user profile for access check:", userProfileError);
      throw new HttpError(403, "Forbidden: Conex admin access required");
    }

    if (!hasConexAccess(sessionUser.id, sessionUser.email, userProfile?.tier)) {
      throw new HttpError(403, "Forbidden: Conex admin access required");
    }

    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";

    // 1. Authentication & Challenge Handling
    if (action === "auth") {
      
      // New Lockout Check
      const { lockKey, ipHash, deviceId } = await checkAdminLockOrThrow(req);
      const ipHashStr = ipHash ?? "noip";

      // Check for existing block (Legacy Logic - can be removed eventually)
      const { data: existingSession } = await supabaseAdmin
        .from("au_admin_sessions")
        .select("*")
        .eq("ip_address", ip)
        .gt("blocked_until", new Date().toISOString())
        .maybeSingle();

      if (existingSession) {
        // Auto-unblock removed for production security
        // await supabaseAdmin.from("au_admin_sessions").update({ blocked_until: null }).eq("ip_address", ip);
      }

      // Step 1: Challenge Question
      if (step === 1) {
        // HARDENED GATE: Use the environment variable for the answer
        const correctAnswer = Deno.env.get("ADMIN_CHALLENGE_ANSWER") || "nobody worth knowing 121##";
        const submittedAnswer = String(answer || "").trim().toLowerCase();
        
        if (submittedAnswer === correctAnswer.toLowerCase()) {
          // Success Step 1
          await recordAdminAttempt(lockKey, ipHashStr, deviceId, "/conex", true, "admin_question");

          // Create or update session
          const { data: session, error: sessErr } = await supabaseAdmin
            .from("au_admin_sessions")
            .upsert({ 
              ip_address: ip, 
              failed_attempts_step1: 0,
              updated_at: new Date().toISOString()
            }, { onConflict: 'ip_address' })
            .select()
            .single();

          if (sessErr || !session) {
            console.error("[admin-handler] Failed to create admin session:", sessErr);
            throw new Error(`Session initialization failed: ${sessErr?.message || 'No session data returned'}`);
          }

          return new Response(JSON.stringify({ ok: true, sessionId: session.id, step: 2 }), { headers: corsHeaders });
        } else {
          // Fail Step 1
          await recordAdminAttempt(lockKey, ipHashStr, deviceId, "/conex", false, "admin_question");

          // Legacy Logic (Safe to leave as backup or for UI feedback)
          const { data: currentSess } = await supabaseAdmin
            .from("au_admin_sessions")
            .select("*")
            .eq("ip_address", ip)
            .maybeSingle();

          const attempts = (currentSess?.failed_attempts_step1 || 0) + 1;
          const patch: any = { ip_address: ip, failed_attempts_step1: attempts, updated_at: new Date().toISOString() };
          
          if (attempts >= MAX_ATTEMPTS_SOFT) {
            const isHard = attempts >= MAX_ATTEMPTS_HARD;
            const lockoutDuration = isHard ? LOCKOUT_MS_HARD : LOCKOUT_MS_SOFT;
            
            patch.blocked_until = new Date(Date.now() + lockoutDuration).toISOString();
            
            // Send alert
            await triggerEmailAlert(supabaseAdmin, "admin_login_failed", { 
              ip, 
              attempts, 
              step: 1,
              lockoutType: isHard ? 'HARD' : 'SOFT'
            });
          }

          await supabaseAdmin.from("au_admin_sessions").upsert(patch, { onConflict: 'ip_address' });

          return new Response(JSON.stringify({ 
            error: "Wrong answer", 
            attemptsLeft: Math.max(0, MAX_ATTEMPTS_SOFT - attempts),
            blocked: attempts >= MAX_ATTEMPTS_SOFT
          }), { status: 401, headers: corsHeaders });
        }
      }

      // Step 2: Access Key
      if (step === 2) {
        if (!sessionId || sessionId === "undefined") {
             return new Response(JSON.stringify({ error: "Session required" }), { status: 400, headers: corsHeaders });
        }

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sessionId)) {
             return new Response(JSON.stringify({ error: "Invalid session ID format" }), { status: 400, headers: corsHeaders });
        }

        const { data: config } = await supabaseAdmin
          .from("au_admin_config")
          .select("value")
          .eq("key", "admin_access_key")
          .single();

        const normalizeKey = (val: any) => {
          let s = String(val || "").trim();
          if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
          return s.trim();
        };

        const correctKey = normalizeKey(config?.value);
        const submittedKey = normalizeKey(accessKey);
        
        if (submittedKey === correctKey) {
          // Success Step 2
          await recordAdminAttempt(lockKey, ipHashStr, deviceId, "/conex", true, "admin_access_key");

          const { data: session, error: updateErr } = await supabaseAdmin
            .from("au_admin_sessions")
            .update({ 
              failed_attempts_step2: 0, 
              is_authenticated: true,
              updated_at: new Date().toISOString()
            })
            .eq("id", sessionId)
            .select()
            .single();

          if (updateErr || !session) {
            console.error("[admin-handler] Failed to finalize admin session:", updateErr);
            throw new Error(`Auth finalization failed: ${updateErr?.message || 'No session data'}`);
          }

          return new Response(JSON.stringify({ ok: true, adminToken: session.id }), { headers: corsHeaders });
        } else {
          // Fail Step 2
          await recordAdminAttempt(lockKey, ipHashStr, deviceId, "/conex", false, "admin_access_key");

          const { data: currentSess } = await supabaseAdmin
            .from("au_admin_sessions")
            .select("*")
            .eq("id", sessionId)
            .single();

          const attempts = (currentSess?.failed_attempts_step2 || 0) + 1;
          const patch: any = { failed_attempts_step2: attempts, updated_at: new Date().toISOString() };
          
          if (attempts >= MAX_ATTEMPTS_SOFT) {
            const isHard = attempts >= MAX_ATTEMPTS_HARD;
            const lockoutDuration = isHard ? LOCKOUT_MS_HARD : LOCKOUT_MS_SOFT;

            patch.blocked_until = new Date(Date.now() + lockoutDuration).toISOString();
            patch.is_authenticated = false;
            await triggerEmailAlert(supabaseAdmin, "admin_login_failed", { ip, attempts, step: 2, sessionId, lockoutType: isHard ? 'HARD' : 'SOFT' });
          }

          await supabaseAdmin.from("au_admin_sessions").update(patch).eq("id", sessionId);

          return new Response(JSON.stringify({ 
            error: "Wrong access key", 
            attemptsLeft: Math.max(0, MAX_ATTEMPTS_SOFT - attempts),
            blocked: attempts >= MAX_ATTEMPTS_SOFT
          }), { status: 401, headers: corsHeaders });
        }
      }
    }

    // 2. Admin API Authorization
    const adminToken = req.headers.get("X-Admin-Token");
    if (!adminToken) return new Response(JSON.stringify({ error: "Admin token required" }), { status: 401, headers: corsHeaders });

    const { data: validSession } = await supabaseAdmin
      .from("au_admin_sessions")
      .select("*")
      .eq("id", adminToken)
      .eq("is_authenticated", true)
      .gt("updated_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // 24h session
      .maybeSingle();

    if (!validSession) return new Response(JSON.stringify({ error: "Invalid or expired admin session" }), { status: 401, headers: corsHeaders });

    // Refresh session timestamp to keep it alive
    await supabaseAdmin
        .from("au_admin_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", adminToken);

    // 3. Admin Actions
    if (!action) {
      return new Response(JSON.stringify({ error: "No action provided" }), { status: 400, headers: corsHeaders });
    }

    if (action === "get_usage") {
      let usage: any[] = [];
      let usageSource: "au_model_usage" | "au_events_fallback" | "au_messages_fallback" = "au_model_usage";
      let usageTableMissing = false;

      const usageRes = await supabaseAdmin
        .from("au_model_usage")
        .select("id,user_id,feature,model_id,prompt_tokens,completion_tokens,total_tokens,cost,metadata,created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (usageRes.error) {
        if (!isMissingTableLikeError(usageRes.error)) {
          throw usageRes.error;
        }
        usageTableMissing = true;
      } else {
        usage = usageRes.data || [];
      }

      if (usage.length === 0) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const eventsRes = await supabaseAdmin
          .from("au_events")
          .select("id,user_id,event_type,timestamp,created_at,metadata")
          .gt("timestamp", sevenDaysAgo)
          .order("timestamp", { ascending: false })
          .limit(100);

        if (!eventsRes.error && Array.isArray(eventsRes.data) && eventsRes.data.length > 0) {
          usage = mapEventsToUsage(eventsRes.data);
          usageSource = "au_events_fallback";
        }
      }

      if (usage.length === 0) {
        const messagesRes = await supabaseAdmin
          .from("au_messages")
          .select("id,user_id,created_at,metadata")
          .order("created_at", { ascending: false })
          .limit(100);

        if (!messagesRes.error && Array.isArray(messagesRes.data) && messagesRes.data.length > 0) {
          usage = (messagesRes.data || []).map((row: any) => {
            const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
            return {
              id: row?.id || crypto.randomUUID(),
              user_id: row?.user_id || null,
              feature: "chat_message",
              model_id: String(metadata?.model_id || metadata?.model || "unknown"),
              prompt_tokens: Number(metadata?.prompt_tokens || 0) || null,
              completion_tokens: Number(metadata?.completion_tokens || 0) || null,
              total_tokens: Number(metadata?.total_tokens || 0) || 0,
              metadata,
              created_at: row?.created_at || new Date().toISOString(),
            };
          });
          usageSource = "au_messages_fallback";
        }
      }

      let tableTotalCalls = 0;
      if (!usageTableMissing) {
        try {
          tableTotalCalls = await safeTableCount(supabaseAdmin, "au_model_usage");
        } catch {
          tableTotalCalls = 0;
        }
      }

      const totalCalls = Math.max(tableTotalCalls, usage.length);
      const failedCalls = (usage || []).filter((row) => inferUsageFailure(row)).length;
      const successfulCalls = Math.max(0, totalCalls - failedCalls);

      let totalUsers = 0;
      try {
        totalUsers = await countAuthUsersWithFallback(supabaseAdmin, adminToken);
      } catch {
        try {
          totalUsers = await safeTableCount(supabaseAdmin, "au_users");
        } catch {
          totalUsers = 0;
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          usage,
          totalUsers,
          usageSource,
          tableMissing: usageTableMissing,
          stats: {
            totalCalls,
            failedCalls,
            successfulCalls,
          },
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "get_conex_config") {
      const config = await getConexConfigSafe(supabaseAdmin);
      return new Response(JSON.stringify({ ok: true, config }), { headers: corsHeaders });
    }

    if (action === "get_au_config") {
      const { data: config, error } = await supabaseAdmin.from("au_config").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, config: config || {} }), { headers: corsHeaders });
    }

    if (action === "get_plan_limits") {
      const { data, error } = await supabaseAdmin
        .from("plan_limits")
        .select("plan, limits, effective_from, updated_at")
        .order("effective_from", { ascending: false });
      if (error) throw error;

      const latestByPlan: Record<string, any> = {};
      for (const row of data || []) {
        const plan = String((row as any)?.plan || "").trim().toLowerCase();
        if (!plan || latestByPlan[plan]) continue;
        latestByPlan[plan] = row;
      }

      return new Response(
        JSON.stringify({
          ok: true,
          rows: data || [],
          limitsByPlan: latestByPlan,
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "update_plan_limits") {
      const plan = String(body?.plan || "").trim().toLowerCase();
      if (!["free", "pro", "premium"].includes(plan)) {
        throw new HttpError(400, "plan must be one of: free, pro, premium");
      }
      const limits = body?.limits && typeof body.limits === "object" && !Array.isArray(body.limits)
        ? body.limits
        : null;
      if (!limits) {
        throw new HttpError(400, "limits object is required");
      }

      const effectiveFrom = normalizeOptionalString(body?.effective_from) || new Date().toISOString();
      const payload = {
        plan,
        limits,
        effective_from: effectiveFrom,
        updated_at: new Date().toISOString(),
      };

      const insertRes = await supabaseAdmin
        .from("plan_limits")
        .upsert(payload, { onConflict: "plan,effective_from" })
        .select()
        .maybeSingle();

      if (insertRes.error) throw insertRes.error;

      return new Response(JSON.stringify({ ok: true, row: insertRes.data || null }), { headers: corsHeaders });
    }

    if (action === "get_feature_flags") {
      const ensured = await ensureFeatureFlags(supabaseAdmin, { requestId, reason: "get_feature_flags" });
      const legacyFlags = (ensured.flags || []).map((flag: any) => ({
        ...flag,
        is_enabled: flag?.enabled === true,
      }));
      return new Response(
        JSON.stringify({
          ok: true,
          flags: legacyFlags,
          missingAdded: ensured.added || [],
          tableMissing: ensured.tableMissing === true,
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "ensure_feature_flags") {
      const ensured = await ensureFeatureFlags(supabaseAdmin, { requestId, reason: "manual_ensure_feature_flags" });
      const legacyFlags = (ensured.flags || []).map((flag: any) => ({
        ...flag,
        is_enabled: flag?.enabled === true,
      }));
      return new Response(
        JSON.stringify({
          ok: true,
          flags: legacyFlags,
          missingAdded: ensured.added || [],
          tableMissing: ensured.tableMissing === true,
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "update_feature_flag") {
      const key = String(body?.key || "").trim();
      const nextEnabled = typeof body?.enabled === "boolean"
        ? Boolean(body.enabled)
        : Boolean(body?.is_enabled);
      if (!key) throw new HttpError(400, "Flag key required");
      if (typeof body?.enabled !== "boolean" && typeof body?.is_enabled !== "boolean") {
        throw new HttpError(400, "Flag value must be boolean");
      }

      await ensureFeatureFlags(supabaseAdmin, { requestId, reason: "update_feature_flag" });

      const existingFlagsPayload = await fetchFeatureFlagsPortable(supabaseAdmin);
      const existing = (existingFlagsPayload.flags || []).find((flag: any) => flag?.key === key);
      const definition = REQUIRED_FEATURE_FLAGS.find((flag) => flag.key === key);
      const category = existing?.category || "billing";
      const description = existing?.description || definition?.description || "";
      const scope = existing?.scope || "global";
      const config = existing?.config || {};

      await upsertFeatureFlagsPortable(supabaseAdmin, [{
        key,
        enabled: nextEnabled,
        category,
        description,
        scope,
        config,
      }]);

      let effectiveBillingEnabled: boolean | null = null;
      if (key === "billing_enabled" && nextEnabled === true) {
        await upsertFeatureFlagsPortable(supabaseAdmin, [{
          key: "promo_enabled",
          enabled: false,
          category: "billing",
          description: "Promo mode switch. When enabled, billing is forced off.",
          scope: "global",
          config: {},
        }]);
        effectiveBillingEnabled = true;
      } else if (key === "billing_enabled") {
        effectiveBillingEnabled = false;
      }

      if (key === "promo_enabled" && nextEnabled === true) {
        await upsertFeatureFlagsPortable(supabaseAdmin, [{
          key: "billing_enabled",
          enabled: false,
          category: "billing",
          description: "Master billing/monetization toggle.",
          scope: "global",
          config: {},
        }]);
        await syncFlagToConexConfigAndLegacy(supabaseAdmin, "billing_enabled", false);
        effectiveBillingEnabled = false;
      } else if (key === "promo_enabled" && nextEnabled === false) {
        const refreshedFlagsSnapshot = await fetchFeatureFlagsPortable(supabaseAdmin);
        const billingFlag = (refreshedFlagsSnapshot.flags || []).find((flag: any) => flag?.key === "billing_enabled");
        effectiveBillingEnabled = billingFlag?.enabled === true;
      }

      if (effectiveBillingEnabled !== null) {
        await upsertFeatureFlagsPortable(supabaseAdmin, [{
          key: "paid_mode_enabled",
          enabled: effectiveBillingEnabled,
          category: "billing",
          description: "Mirrors billing_enabled to avoid redundant toggle state drift.",
          scope: "global",
          config: {},
        }]);
      }

      if (MIRRORED_FLAG_KEYS.has(String(key))) {
        await syncFlagToConexConfigAndLegacy(supabaseAdmin, String(key), nextEnabled);
      }

      await safeInsertDebugLog(supabaseAdmin, "Feature flag updated", {
        requestId,
        key,
        enabled: nextEnabled,
      });

      const refreshedPayload = await fetchFeatureFlagsPortable(supabaseAdmin);
      const refreshedFlag = (refreshedPayload.flags || []).find((flag: any) => flag?.key === key) || null;

      return new Response(JSON.stringify({ ok: true, flag: refreshedFlag }), { headers: corsHeaders });
    }

    if (action === "update_conex_config") {
      const { config } = body;
      const normalizedConfig = normalizeConexConfigPayload(config);

      const { data, error } = await supabaseAdmin
        .from("au_conex_config")
        .upsert({ ...normalizedConfig, id: 1 })
        .select();
      if (error) throw error;

      // Keep billing_enabled mirrored to au_config for legacy RPCs/functions.
      if (Object.prototype.hasOwnProperty.call(normalizedConfig, "billing_enabled")) {
        const billingEnabled = asBoolean(normalizedConfig.billing_enabled, false);
        const { data: legacyConfig } = await supabaseAdmin
          .from("au_config")
          .select("id")
          .limit(1)
          .maybeSingle();

        if (legacyConfig?.id) {
          const { error: legacyUpdateError } = await supabaseAdmin
            .from("au_config")
            .update({ billing_enabled: billingEnabled, updated_at: new Date().toISOString() })
            .eq("id", legacyConfig.id);
          if (legacyUpdateError) throw legacyUpdateError;
        } else {
          const { error: legacyInsertError } = await supabaseAdmin
            .from("au_config")
            .insert([{ billing_enabled: billingEnabled, updated_at: new Date().toISOString() }]);
          if (legacyInsertError) throw legacyInsertError;
        }
      }

      await ensureFeatureFlags(supabaseAdmin, { requestId, reason: "update_conex_config" });
      await syncConexConfigToFeatureFlags(supabaseAdmin, normalizedConfig, "update_conex_config");
      if (normalizedConfig.billing_enabled === true) {
        await upsertFeatureFlagsPortable(supabaseAdmin, [{
          key: "promo_enabled",
          enabled: false,
          category: "billing",
          description: "Promo mode switch. When enabled, billing is forced off.",
          scope: "global",
          config: {},
        }]);
      }

      // Master Switch Side Effects
      if (normalizedConfig.billing_enabled === true) {
          // Auto-enable keys if Billing is turned ON
          await supabaseAdmin
              .from('au_api_keys')
              .update({ is_active: true, error_count: 0 })
              .in('service', ['openrouter_1', 'openrouter_primary']);
      }

      return new Response(JSON.stringify({ ok: true, data }), { headers: corsHeaders });
    }

    if (action === "update_au_config") {
      const { config } = body;

      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("au_config")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (existingErr) throw existingErr;

      const payload: any = {
        billing_enabled: !!config?.billing_enabled,
        free_chat_daily_limit: Number(config?.free_chat_daily_limit ?? 0),
        free_exam_daily_limit: Number(config?.free_exam_daily_limit ?? 0),
        free_upload_daily_limit: Number(config?.free_upload_daily_limit ?? 0),
        free_max_upload_mb: Number(config?.free_max_upload_mb ?? 0),
        updated_at: new Date().toISOString(),
      };

      let saved;
      if (existing?.id) {
        const { data, error } = await supabaseAdmin
          .from("au_config")
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await supabaseAdmin
          .from("au_config")
          .insert([{ ...payload }])
          .select()
          .single();
        if (error) throw error;
        saved = data;
      }

      // Legacy mirror (keep existing UI/features working)
      const { error: mirrorError } = await supabaseAdmin
        .from("au_conex_config")
        .upsert({
          id: 1,
          billing_enabled: !!config?.billing_enabled,
          updated_at: new Date().toISOString(),
        });
      if (mirrorError) throw mirrorError;

      await ensureFeatureFlags(supabaseAdmin, { requestId, reason: "update_au_config" });
      await syncConexConfigToFeatureFlags(
        supabaseAdmin,
        { billing_enabled: !!config?.billing_enabled },
        "update_au_config",
      );

      // Side effect: If Billing is turned ON, auto-enable keys
      if (config?.billing_enabled === true) {
        await supabaseAdmin
          .from('au_api_keys')
          .update({ is_active: true, error_count: 0 })
          .in('service', ['openrouter_1', 'openrouter_primary']);
      }

      return new Response(JSON.stringify({ ok: true, config: saved }), { headers: corsHeaders });
    }

    if (action === "get_manual_payments") {
      const { data: allPayments, error } = await supabaseAdmin
        .from("au_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw error;

      const manualPayments = (allPayments || []).filter((payment: any) => isManualPaymentRow(payment));
      const userIds = Array.from(
        new Set(
          manualPayments
            .map((payment: any) => extractPaymentUserId(payment))
            .filter((entry: any) => typeof entry === "string" && entry.length > 0),
        ),
      );

      const { usersMap, profilesMap } = await buildPaymentUserMaps(supabaseAdmin, userIds as string[]);
      const enriched = manualPayments.map((payment: any) => {
        const userId = extractPaymentUserId(payment);
        const normalizedStatus = normalizePaymentStatus(payment.status);
        return {
          ...payment,
          user_id: userId,
          reference_code: extractPaymentReference(payment),
          amount: extractPaymentAmount(payment),
          status: normalizedStatus,
          status_label: normalizedStatus,
          channel: payment?.channel || "bank_transfer",
          au_users: { email: userId ? (usersMap[userId]?.email || null) : null },
          au_user_profiles: { full_name: userId ? (profilesMap[userId]?.full_name || null) : null },
        };
      });

      return new Response(JSON.stringify({ ok: true, payments: enriched }), { headers: corsHeaders });
    }

    if (action === "get_card_payments") {
      const { data: allPayments, error } = await supabaseAdmin
        .from("au_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw error;

      const cardPayments = (allPayments || []).filter((payment: any) => isCardPaymentRow(payment));
      const userIds = Array.from(
        new Set(
          cardPayments
            .map((payment: any) => extractPaymentUserId(payment))
            .filter((entry: any) => typeof entry === "string" && entry.length > 0),
        ),
      );

      const { usersMap, profilesMap } = await buildPaymentUserMaps(supabaseAdmin, userIds as string[]);
      const enriched = cardPayments.map((payment: any) => {
        const userId = extractPaymentUserId(payment);
        const normalizedStatus = normalizePaymentStatus(payment.status);
        return {
          ...payment,
          user_id: userId,
          reference_code: extractPaymentReference(payment),
          amount: extractPaymentAmount(payment),
          status_normalized: normalizedStatus,
          provider: payment?.provider || "unknown",
          channel: payment?.channel || "card",
          au_users: { email: userId ? (usersMap[userId]?.email || null) : null },
          au_user_profiles: { full_name: userId ? (profilesMap[userId]?.full_name || null) : null },
        };
      });

      return new Response(JSON.stringify({ ok: true, payments: enriched }), { headers: corsHeaders });
    }

    if (action === "process_manual_payment") {
      const { paymentId, status } = body;
      if (!paymentId || !["confirmed", "rejected"].includes(status)) {
        throw new HttpError(400, "Invalid parameters", { paymentId, status });
      }

      const { data: payment, error: payErr } = await supabaseAdmin
        .from("au_payments")
        .update({
          status,
          confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentId)
        .select()
        .single();
      if (payErr) throw payErr;

      const paymentUserId = extractPaymentUserId(payment);
      if (status === "confirmed" && paymentUserId) {
        const { data: profile } = await supabaseAdmin
          .from("au_user_profiles")
          .select("tier_expires_at")
          .eq("user_id", paymentUserId)
          .single();

        const now = new Date();
        const plan = String(payment?.plan || "").toLowerCase();
        const durationDays = plan === "weekly" ? 7 : 30;
        let expiry = new Date(now);

        if (profile?.tier_expires_at && new Date(profile.tier_expires_at) > now) {
          expiry = new Date(profile.tier_expires_at);
          expiry.setDate(expiry.getDate() + durationDays);
        } else {
          expiry.setDate(now.getDate() + durationDays);
        }

        const paymentAmount = extractPaymentAmount(payment);
        await supabaseAdmin
          .from("au_user_profiles")
          .update({
            tier: "pro",
            stripe_status: "active",
            last_payment_date: new Date().toISOString(),
            last_payment_amount: paymentAmount,
            tier_expires_at: expiry.toISOString(),
            billing_source: "manual",
          })
          .eq("user_id", paymentUserId);

        const referenceCode = extractPaymentReference(payment);
        try {
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-invoice`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: paymentUserId,
              amount: paymentAmount,
              plan: payment.plan,
              refCode: referenceCode,
              paymentId: payment.id,
            }),
          }).catch((invoiceError) => console.error("Invoice trigger failed:", invoiceError));
        } catch (invoiceOuterError) {
          console.error("Invoice logic error:", invoiceOuterError);
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          payment: {
            ...payment,
            user_id: paymentUserId,
            reference_code: extractPaymentReference(payment),
            amount: extractPaymentAmount(payment),
            status: normalizePaymentStatus(payment?.status),
          },
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "get_registry") {
      const keyAlias = normalizeOptionalString(body?.keyAlias);

      const envKey = String(Deno.env.get("OPENROUTER_API_KEY") || "").trim();
      const hasEnvKey = envKey.length > 10;
      const maskedEnvKey = hasEnvKey ? `${envKey.slice(0, 6)}...${envKey.slice(-4)}` : null;

      let keys: any[] = [];
      let keysTableMissing = false;
      let seededKeys = 0;

      const keysRes = await supabaseAdmin
        .from("au_api_keys")
        .select("*")
        .order("service", { ascending: true });
      if (keysRes.error) {
        if (isMissingTableLikeError(keysRes.error)) {
          keysTableMissing = true;
        } else {
          throw keysRes.error;
        }
      } else {
        keys = keysRes.data || [];
      }

      if (!keysTableMissing && keys.length === 0) {
        const seedRows: any[] = [];
        if (hasEnvKey) {
          seedRows.push({
            service: "openrouter_1",
            provider_type: "openrouter",
            key_value: envKey,
            is_active: true,
            metadata: { tier: "free", seeded_by: "admin-handler" },
            allowed_models: null,
            updated_at: new Date().toISOString(),
          });
          seedRows.push({
            service: "openrouter_primary",
            provider_type: "openrouter",
            key_value: envKey,
            is_active: true,
            metadata: { tier: "pro", seeded_by: "admin-handler" },
            allowed_models: null,
            updated_at: new Date().toISOString(),
          });
        }

        if (seedRows.length > 0) {
          const seedKeysRes = await supabaseAdmin
            .from("au_api_keys")
            .upsert(seedRows, { onConflict: "service" });
          if (!seedKeysRes.error) {
            seededKeys = seedRows.length;
            const refetchKeys = await supabaseAdmin
              .from("au_api_keys")
              .select("*")
              .order("service", { ascending: true });
            if (!refetchKeys.error) {
              keys = refetchKeys.data || [];
            }
          }
        }
      }

      const keyRow = (keys || []).find((k: any) => k?.service === keyAlias);
      const selectedTier = String(keyRow?.metadata?.tier || "").toLowerCase();
      const inferredProByAlias = String(keyAlias || "").toLowerCase().includes("primary");
      const registrySource: "free" | "pro" = selectedTier === "pro" || inferredProByAlias ? "pro" : "free";
      const modelsTable = registrySource === "pro" ? "au_pro_models_registry" : "au_models_registry";
      const defaultModels = registrySource === "pro" ? DEFAULT_PRO_REGISTRY_MODELS : DEFAULT_FREE_REGISTRY_MODELS;

      let models: any[] = [];
      let modelsTableMissing = false;
      let seededModels = 0;

      const modelsRes = await supabaseAdmin
        .from(modelsTable)
        .select("*")
        .order("model_id", { ascending: true });
      if (modelsRes.error) {
        if (isMissingTableLikeError(modelsRes.error)) {
          modelsTableMissing = true;
        } else {
          throw modelsRes.error;
        }
      } else {
        models = modelsRes.data || [];
      }

      if (!modelsTableMissing && models.length === 0) {
        const seedRows = defaultModels.map((model) => ({
          ...model,
          updated_at: new Date().toISOString(),
        }));
        const seedModelsRes = await supabaseAdmin
          .from(modelsTable)
          .upsert(seedRows, { onConflict: "model_id" });

        if (!seedModelsRes.error) {
          seededModels = seedRows.length;
          const refetchModels = await supabaseAdmin
            .from(modelsTable)
            .select("*")
            .order("model_id", { ascending: true });
          if (!refetchModels.error) {
            models = refetchModels.data || [];
          }
        }
      }

      if (modelsTableMissing && models.length === 0) {
        models = defaultModels.map((model) => ({
          ...model,
          updated_at: new Date().toISOString(),
          _readonly_fallback: true,
        }));
      }

      let settings: any[] = [];
      let settingsTableMissing = false;
      const settingsRes = await supabaseAdmin
        .from("au_rag_settings")
        .select("*")
        .order("key", { ascending: true });
      if (settingsRes.error) {
        if (isMissingTableLikeError(settingsRes.error)) {
          settingsTableMissing = true;
        } else {
          throw settingsRes.error;
        }
      } else {
        settings = settingsRes.data || [];
      }

      const maskedKeys = (keys || []).map((k: any) => ({
        ...k,
        key_value: k.key_value ? `...${String(k.key_value).slice(-4)}` : null,
        allowed_models: Array.isArray(k.allowed_models) ? k.allowed_models : (k.allowed_models === null ? null : []),
      }));

      if (keysTableMissing && hasEnvKey) {
        maskedKeys.push({
          service: "openrouter_env",
          provider_type: "openrouter",
          key_value: maskedEnvKey,
          is_active: true,
          metadata: { tier: "free", source: "env" },
          allowed_models: null,
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          keys: maskedKeys,
          models: models || [],
          settings,
          env: {
            hasOpenRouterKey: hasEnvKey,
            maskedOpenRouterKey: maskedEnvKey,
          },
          registrySource,
          diagnostics: {
            keysTableMissing,
            modelsTableMissing,
            settingsTableMissing,
            seededKeys,
            seededModels,
          },
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "update_api_key") {
      const { keyData } = body;
      if (!keyData || !keyData.service) throw new HttpError(400, "Invalid key data: service required");
      
      const service = String(keyData.service || "").trim();
      if (!service) throw new HttpError(400, "Invalid key data: service required");
      const isActiveExplicit = typeof keyData.is_active === "boolean" ? keyData.is_active : undefined;

      const rawKeyValue = typeof keyData.key_value === "string" ? keyData.key_value.trim() : "";
      const providedKeyValue = rawKeyValue && !rawKeyValue.startsWith("...") ? rawKeyValue : "";

      const { data: existingKey, error: existingErr } = await supabaseAdmin
        .from("au_api_keys")
        .select("service")
        .eq("service", service)
        .maybeSingle();

      if (existingErr) throw existingErr;

      const allowedModels =
        keyData.allowed_models === null
          ? null
          : Array.isArray(keyData.allowed_models)
            ? keyData.allowed_models
            : [];

      // Construct update object
      const updatePayload: any = { 
        service,
        provider_type: keyData.provider_type || 'openrouter',
        is_active: isActiveExplicit ?? true,
        allowed_models: allowedModels,
        metadata: keyData.metadata || {}, 
        updated_at: new Date().toISOString()
      };

      // Manual re-activation should clear stale strike counts so it does not
      // immediately flip back to inactive on the next failure report.
      if (isActiveExplicit === true) {
        updatePayload.error_count = 0;
      }

      if (providedKeyValue) {
        updatePayload.key_value = providedKeyValue;
      } else if (!existingKey) {
        const envOpenRouter = Deno.env.get("OPENROUTER_API_KEY") || "";
        if (updatePayload.provider_type === "openrouter" && envOpenRouter.trim().length > 10) {
          updatePayload.key_value = envOpenRouter.trim();
        }
      }

      if (!existingKey && !updatePayload.key_value) {
        return new Response(JSON.stringify({ error: "API key value is required for a new service." }), { status: 400, headers: corsHeaders });
      }

      let error;
      if (existingKey) {
          // Explicit Update
          const { error: updateErr } = await supabaseAdmin
            .from("au_api_keys")
            .update(updatePayload)
            .eq("service", service);
          error = updateErr;
      } else {
          // Explicit Insert
          const { error: insertErr } = await supabaseAdmin
            .from("au_api_keys")
            .insert([updatePayload]);
          error = insertErr;
      }

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "delete_api_key") {
      const { service } = body;
      if (!service) throw new HttpError(400, "Service required");
      
      const { error } = await supabaseAdmin
        .from("au_api_keys")
        .delete()
        .eq("service", service);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "update_model") {
      const { model, registry } = body;
      if (!model || !model.model_id) throw new HttpError(400, "Invalid model data");

      const registrySource = String(registry || "free").toLowerCase() === "pro" ? "pro" : "free";
      const modelsTable = registrySource === "pro" ? "au_pro_models_registry" : "au_models_registry";

      const { error } = await supabaseAdmin
        .from(modelsTable)
        .upsert({
          model_id: model.model_id,
          display_name: model.display_name,
          provider: model.provider || 'openrouter',
          type: model.type || 'chat',
          is_free: model.is_free ?? false,
          is_active: model.is_active ?? true,
          context_window: model.context_window || 4096,
          rate_limit_rpm: model.rate_limit_rpm || 20,
          rate_limit_tpm: model.rate_limit_tpm || 100000,
          usage_constraints: model.usage_constraints || {},
          updated_at: new Date().toISOString()
        });
      
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "delete_model") {
      const { modelId, registry } = body;
      if (!modelId) throw new HttpError(400, "Model ID required");

      const registrySource = String(registry || "free").toLowerCase() === "pro" ? "pro" : "free";
      const modelsTable = registrySource === "pro" ? "au_pro_models_registry" : "au_models_registry";

      const { error } = await supabaseAdmin
        .from(modelsTable)
        .delete()
        .eq("model_id", modelId);
      
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "get_active_users") {
      const windowStartIso = new Date(Date.now() - LIVE_ACTIVITY_WINDOW_MINUTES * 60 * 1000).toISOString();
      const onlineWindowIso = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();

      let events: any[] = [];
      let source: "au_events" | "au_user_activity" = "au_events";
      let eventsTableMissing = false;

      const eventsRes = await supabaseAdmin
        .from("au_events")
        .select("id,user_id,event_type,timestamp,created_at,metadata")
        .gt("timestamp", windowStartIso)
        .order("timestamp", { ascending: false })
        .limit(200);

      if (eventsRes.error) {
        if (!isMissingTableLikeError(eventsRes.error)) {
          throw eventsRes.error;
        }
        eventsTableMissing = true;
      } else {
        events = eventsRes.data || [];
      }

      type ActivityRow = { user_id: string; last_active_at: string; is_pwa: boolean | null; metadata: any };
      if (events.length === 0) {
        const activityRes = await supabaseAdmin
          .from("au_user_activity")
          .select("user_id,last_active_at,is_pwa,metadata")
          .gt("last_active_at", windowStartIso)
          .order("last_active_at", { ascending: false })
          .limit(200);

        if (!activityRes.error) {
          source = "au_user_activity";
          events = ((activityRes.data as ActivityRow[] | null) || []).map((row: ActivityRow) => ({
            id: `activity-${row.user_id}`,
            user_id: row.user_id,
            event_type: "heartbeat",
            timestamp: row.last_active_at,
            metadata: {
              type: "Auth",
              pwa: row.is_pwa,
              device: row?.metadata?.device || {},
              connection: row?.metadata?.connection || {},
            },
          }));
        }
      }

      const activeUserIds = new Set<string>();
      for (const event of events || []) {
        const timestamp = event?.timestamp || event?.created_at;
        const userId = String(event?.user_id || "");
        if (!timestamp || !userId) continue;
        if (new Date(timestamp).getTime() >= new Date(onlineWindowIso).getTime()) {
          activeUserIds.add(userId);
        }
      }

      const sorted = (events || [])
        .slice()
        .sort((a, b) => new Date(b?.timestamp || b?.created_at || 0).getTime() - new Date(a?.timestamp || a?.created_at || 0).getTime());

      return new Response(
        JSON.stringify({
          ok: true,
          events: sorted,
          source,
          windowMinutes: LIVE_ACTIVITY_WINDOW_MINUTES,
          activeUsers: activeUserIds.size,
          diagnostics: {
            eventsTableMissing,
          },
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "get_users") {
      // 1. Get Auth Users (Supabase)
      const { users: authUsers } = await listAuthUsersWithFallback(supabaseAdmin, adminToken, { page: 1, pageSize: 1000 });

      // 2. Get All AU Users (Unified Identity)
      const { data: allAuUsers } = await supabaseAdmin
        .from("au_users")
        .select(`
          id, 
          provider, 
          email, 
          created_at, 
          last_sign_in_at:updated_at,
          au_user_profiles ( full_name )
        `);
      
      // 3. Get User Activity (for device info)
      // Filter activity to only include valid users
      const { data: activity } = await supabaseAdmin.from("au_user_activity").select("*");

      // 5. Merge Strategy
      // We start with au_users (Unified Identity) as the source of truth.
      // We enrich with auth.users data if available (for Supabase users).
      
      const unifiedUsers = (allAuUsers || []).map((auUser: any) => {
        const authUser = authUsers.find((u: any) => u.id === auUser.id);
        const act = activity?.find((a: any) => a.user_id === auUser.id);

        const displayName =
          auUser.au_user_profiles?.[0]?.full_name ||
          authUser?.user_metadata?.full_name ||
          authUser?.user_metadata?.name ||
          (auUser.email || authUser?.email || '').split('@')[0] ||
          'User';
        
        return {
          id: auUser.id,
          user_id: auUser.id, // Explicit for frontend
          email: auUser.email || authUser?.email,
          full_name: displayName,
          provider: auUser.provider,
          created_at: auUser.created_at,
          last_sign_in_at: authUser?.last_sign_in_at || auUser.last_sign_in_at,
          last_active_at: act?.last_active_at || authUser?.last_sign_in_at || auUser.last_sign_in_at,
          device_info: act?.metadata?.device || {},
          is_pwa: act?.is_pwa || false
        };
      });

      // Find any orphaned auth.users (shouldn't exist if sync trigger works, but safety net)
      const orphanedAuthUsers = authUsers
        .filter((u: any) => !unifiedUsers.find((au: any) => au.id === u.id))
        .map((u: any) => {
          const act = activity?.find((a: any) => a.user_id === u.id);
          const displayName =
            u?.user_metadata?.full_name ||
            u?.user_metadata?.name ||
            (u.email || '').split('@')[0] ||
            'User';
          return {
            ...u,
            user_id: u.id,
            full_name: displayName,
            provider: 'supabase',
            last_active_at: act?.last_active_at || u.last_sign_in_at,
            device_info: act?.metadata?.device || {},
            is_pwa: act?.is_pwa || false
          };
        });

      return new Response(JSON.stringify({ 
        ok: true, 
        users: { 
          authenticated: [...unifiedUsers, ...orphanedAuthUsers]
        } 
      }), { headers: corsHeaders });
    }

    if (action === "list_users") {
      const {
        q,
        type = "all",
        provider = "all",
        sortBy = "last_active_at",
        sortDir = "desc",
        page = 1,
        pageSize = 50
      } = body || {};

      const normalizedPage = Math.max(1, Number(page) || 1);
      const normalizedPageSize = Math.min(200, Math.max(1, Number(pageSize) || 50));
      const normalizedQ = typeof q === "string" ? q.trim().toLowerCase() : "";

      const { users: authUsers } = await listAuthUsersWithFallback(supabaseAdmin, adminToken, { q: normalizedQ, page: 1, pageSize: 1000 });

      const { data: allAuUsers } = await supabaseAdmin
        .from("au_users")
        .select(`
          id,
          provider,
          email,
          created_at,
          last_sign_in_at:updated_at,
          au_user_profiles ( full_name )
        `);

      const knownIds = new Set([
          ...(allAuUsers || []).map((u: any) => u.id), 
          ...(authUsers || []).map((u: any) => u.id)
      ]);
      
      const { data: activity } = await supabaseAdmin.from("au_user_activity").select("*");
      const validActivity = (activity || []).filter((a: any) => knownIds.has(a.user_id));

      const authRows = (allAuUsers || []).map((auUser: any) => {
        const authUser = authUsers.find((u: any) => u.id === auUser.id);
        const act = validActivity.find((a: any) => a.user_id === auUser.id);
        const connection = act?.metadata?.connection || null;
        const rawDevice = act?.metadata?.device || {};
        const device_info = rawDevice?.browser ? rawDevice : { ...rawDevice, browser: act?.user_agent || authUser?.user_metadata?.user_agent || "" };

        const displayName =
          auUser.au_user_profiles?.[0]?.full_name ||
          authUser?.user_metadata?.full_name ||
          authUser?.user_metadata?.name ||
          (auUser.email || authUser?.email || "").split("@")[0] ||
          "User";

        return {
          type: "Auth",
          id: auUser.id,
          user_id: auUser.id,
          email: auUser.email || authUser?.email,
          full_name: displayName,
          provider: auUser.provider,
          created_at: auUser.created_at,
          last_sign_in_at: authUser?.last_sign_in_at || auUser.last_sign_in_at,
          last_active_at: act?.last_active_at || authUser?.last_sign_in_at || auUser.last_sign_in_at,
          device_info,
          connection,
          is_pwa: act?.is_pwa || false
        };
      });

      const orphanedAuthRows = authUsers
        .filter((u: any) => !authRows.find((au: any) => au.id === u.id))
        .map((u: any) => {
          const act = validActivity.find((a: any) => a.user_id === u.id);
          const connection = act?.metadata?.connection || null;
          const rawDevice = act?.metadata?.device || {};
          const device_info = rawDevice?.browser ? rawDevice : { ...rawDevice, browser: act?.user_agent || u?.user_metadata?.user_agent || "" };
          const displayName =
            u?.user_metadata?.full_name ||
            u?.user_metadata?.name ||
            (u.email || "").split("@")[0] ||
            "User";
          return {
            type: "Auth",
            id: u.id,
            user_id: u.id,
            email: u.email,
            full_name: displayName,
            provider: "supabase",
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
            last_active_at: act?.last_active_at || u.last_sign_in_at,
            device_info,
            connection,
          is_pwa: act?.is_pwa || false
          };
        });

      let rows: any[] = [];
      if (type === "auth") rows = [...authRows, ...orphanedAuthRows];
      else rows = [...authRows, ...orphanedAuthRows];
      
      // Strict ID Filter: If we still have rows that don't match known DB IDs, drop them
      // This is a double-safety check
      rows = rows.filter(r => knownIds.has(r.id));

      if (provider !== "all") {
        rows = rows.filter((r) => r.provider === provider);
      }

      if (normalizedQ) {
        rows = rows.filter((r) => {
          const email = (r.email || "").toLowerCase();
          const name = (r.full_name || "").toLowerCase();
          const id = (r.user_id || "").toLowerCase();
          return email.includes(normalizedQ) || name.includes(normalizedQ) || id.includes(normalizedQ);
        });
      }

      const sortKey = String(sortBy);
      const dir = String(sortDir).toLowerCase() === "asc" ? 1 : -1;

      rows.sort((a, b) => {
        const av = a?.[sortKey];
        const bv = b?.[sortKey];

        if (sortKey.includes("at")) {
          const at = av ? new Date(av).getTime() : 0;
          const bt = bv ? new Date(bv).getTime() : 0;
          return dir * (at - bt);
        }

        if (typeof av === "string" || typeof bv === "string") {
          return dir * String(av || "").localeCompare(String(bv || ""));
        }

        return dir * ((av || 0) - (bv || 0));
      });

      const total = rows.length;
      const start = (normalizedPage - 1) * normalizedPageSize;
      const paged = rows.slice(start, start + normalizedPageSize);

      return new Response(JSON.stringify({
        ok: true,
        users: paged,
        total,
        page: normalizedPage,
        pageSize: normalizedPageSize
      }), { headers: corsHeaders });
    }

    if (action === "bulk_delete") {
      const { items } = body || {};
      if (!Array.isArray(items)) throw new HttpError(400, "items[] is required");

      for (const item of items) {
        const id = item?.id;
        const itemType = item?.type;
        if (!id || !itemType) continue;

        await supabaseAdmin.from("au_user_activity").delete().eq("user_id", id);
        await supabaseAdmin.from("au_messages").delete().eq("user_id", id);
        await supabaseAdmin.from("au_sessions").delete().eq("user_id", id);
        await supabaseAdmin.from("au_user_profiles").delete().eq("user_id", id);
        await supabaseAdmin.from("au_users").delete().eq("id", id);

        try {
          await supabaseAdmin.auth.admin.deleteUser(id);
        } catch {
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "export_users_csv") {
      const {
        q,
        type = "all",
        provider = "all",
        sortBy = "last_active_at",
        sortDir = "desc"
      } = body || {};

      const listRes = await (async () => {
        const { data: { users: authUsers }, error } = await supabaseAdmin.auth.admin.listUsers();
        if (error) throw error;

        const { data: allAuUsers } = await supabaseAdmin
          .from("au_users")
          .select(`
            id,
            provider,
            email,
            created_at,
            last_sign_in_at:updated_at,
            au_user_profiles ( full_name )
          `);

        const { data: activity } = await supabaseAdmin.from("au_user_activity").select("*");

        const authRows = (allAuUsers || []).map((auUser: any) => {
          const authUser = authUsers.find((u: any) => u.id === auUser.id);
          const act = activity?.find((a: any) => a.user_id === auUser.id);

          const displayName =
            auUser.au_user_profiles?.[0]?.full_name ||
            authUser?.user_metadata?.full_name ||
            authUser?.user_metadata?.name ||
            (auUser.email || authUser?.email || "").split("@")[0] ||
            "User";

          return {
            type: "Auth",
            user_id: auUser.id,
            email: auUser.email || authUser?.email || "",
            full_name: displayName,
            provider: auUser.provider,
            created_at: auUser.created_at,
            last_active_at: act?.last_active_at || authUser?.last_sign_in_at || auUser.last_sign_in_at,
            is_pwa: act?.is_pwa || false,
            time_zone: act?.metadata?.device?.timeZone || ""
          };
        });

        let rows: any[] = [];
        if (type === "auth") rows = authRows;
        else if (type === "guest") rows = [];
        else rows = authRows;

        if (provider !== "all") rows = rows.filter((r) => r.provider === provider);

        const normalizedQ = typeof q === "string" ? q.trim().toLowerCase() : "";
        if (normalizedQ) {
          rows = rows.filter((r) => {
            const email = (r.email || "").toLowerCase();
            const name = (r.full_name || "").toLowerCase();
            const id = (r.user_id || "").toLowerCase();
            return email.includes(normalizedQ) || name.includes(normalizedQ) || id.includes(normalizedQ);
          });
        }

        const sortKey = String(sortBy);
        const dir = String(sortDir).toLowerCase() === "asc" ? 1 : -1;
        rows.sort((a, b) => {
          const av = a?.[sortKey];
          const bv = b?.[sortKey];
          if (sortKey.includes("at")) {
            const at = av ? new Date(av).getTime() : 0;
            const bt = bv ? new Date(bv).getTime() : 0;
            return dir * (at - bt);
          }
          return dir * String(av || "").localeCompare(String(bv || ""));
        });

        return rows;
      })();

      const header = [
        "type",
        "user_id",
        "email",
        "full_name",
        "provider",
        "created_at",
        "last_active_at",
        "is_pwa",
        "time_zone"
      ];

      const escape = (v: any) => {
        const s = String(v ?? "");
        if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const lines = [header.join(",")].concat(
        listRes.map((r: any) => header.map((k) => escape(r[k])).join(","))
      );

      const csv = lines.join("\n");

      return new Response(JSON.stringify({
        ok: true,
        csv,
        filename: `users_export_${new Date().toISOString().slice(0, 10)}.csv`
      }), { headers: corsHeaders });
    }

    if (action === "delete_user") {
      const { userId } = body;
      if (!userId) throw new HttpError(400, "User ID required");
      
      // Pre-cleanup user data to avoid FK constraints if CASCADE is missing
      await supabaseAdmin.from("au_user_activity").delete().eq("user_id", userId);
      await supabaseAdmin.from("au_messages").delete().eq("user_id", userId);
      await supabaseAdmin.from("au_sessions").delete().eq("user_id", userId);
      await supabaseAdmin.from("au_user_profiles").delete().eq("user_id", userId);
      await supabaseAdmin.from("au_users").delete().eq("id", userId);
      // We don't delete documents here as they might be important, but for a full wipe we should.
      // For now, let's just clear activity and messages.
      
      // Delete from Auth (cascades to other tables if configured)
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw error;
      
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "clear_logs") {
      const { error } = await supabaseAdmin.from("au_debug_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "send_user_notification") {
      const { targetUserId, title, content, expiresAt } = body;
      const { error } = await supabaseAdmin
        .from("au_user_notifications")
        .insert([{ 
          user_id: targetUserId || null, 
          title, 
          content, 
          expires_at: expiresAt 
        }]);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "get_feedback") {
      const { data: feedback } = await supabaseAdmin
        .from("au_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return new Response(JSON.stringify({ ok: true, feedback }), { headers: corsHeaders });
    }

    if (action === "get_alert_config") {
      let configs: any[] = [];
      let tableMissing = false;
      let seeded = 0;

      const configsRes = await supabaseAdmin
        .from("au_admin_email_alerts")
        .select("*")
        .order("event_type", { ascending: true });

      if (configsRes.error) {
        if (isMissingTableLikeError(configsRes.error)) {
          tableMissing = true;
        } else {
          throw configsRes.error;
        }
      } else {
        configs = configsRes.data || [];
      }

      if (!tableMissing && configs.length === 0) {
        const defaults = buildDefaultAlertConfigs();
        const seedRes = await supabaseAdmin
          .from("au_admin_email_alerts")
          .upsert(defaults, { onConflict: "event_type" });
        if (!seedRes.error) {
          seeded = defaults.length;
          const refetch = await supabaseAdmin
            .from("au_admin_email_alerts")
            .select("*")
            .order("event_type", { ascending: true });
          if (!refetch.error) configs = refetch.data || [];
        } else if (errorCode(seedRes.error) === "42P10") {
          // Missing unique constraint on event_type, fallback to insert.
          const insertRes = await supabaseAdmin
            .from("au_admin_email_alerts")
            .insert(defaults);
          if (!insertRes.error) {
            seeded = defaults.length;
            const refetch = await supabaseAdmin
              .from("au_admin_email_alerts")
              .select("*")
              .order("event_type", { ascending: true });
            if (!refetch.error) configs = refetch.data || [];
          }
        }
      }

      if (tableMissing && configs.length === 0) {
        configs = buildDefaultAlertConfigs().map((item, idx) => ({
          id: `fallback-${idx}`,
          ...item,
          _readonly_fallback: true,
        }));
      }

      return new Response(
        JSON.stringify({
          ok: true,
          configs,
          diagnostics: {
            tableMissing,
            seeded,
          },
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "update_alert_config") {
      const { config } = body;
      const eventType = normalizeOptionalString(config?.event_type);
      if (!eventType) throw new HttpError(400, "event_type is required");

      const payload = {
        event_type: eventType,
        recipients: normalizeRecipients(config?.recipients),
        is_enabled: asBoolean(config?.is_enabled, false),
        updated_at: new Date().toISOString(),
      };

      let writeError: any = null;

      if (config?.id) {
        const updateRes = await supabaseAdmin
          .from("au_admin_email_alerts")
          .update(payload)
          .eq("id", config.id);
        writeError = updateRes.error;
      } else {
        const upsertRes = await supabaseAdmin
          .from("au_admin_email_alerts")
          .upsert(payload, { onConflict: "event_type" });
        writeError = upsertRes.error;

        if (writeError && errorCode(writeError) === "42P10") {
          // No unique constraint for onConflict target. Fallback to insert-only.
          const insertRes = await supabaseAdmin
            .from("au_admin_email_alerts")
            .insert(payload);
          writeError = insertRes.error;
        }
      }

      if (writeError) {
        if (isMissingTableLikeError(writeError)) {
          throw new HttpError(503, "Email alerts table missing. Apply Conex admin migrations first.");
        }
        throw writeError;
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "get_analytics") {
      const countSafe = async (table: string) => {
        try {
          return await safeTableCount(supabaseAdmin, table);
        } catch {
          return 0;
        }
      };

      const docCount = await countSafe("au_documents");
      const chunkCount = await countSafe("au_document_chunks");
      const msgCount = await countSafe("au_messages");
      const usageCount = await countSafe("au_model_usage");

      let totalUsers = 0;
      try {
        totalUsers = await countAuthUsersWithFallback(supabaseAdmin, adminToken);
      } catch {
        totalUsers = await countSafe("au_users");
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date();

      const daysMap = new Map<string, { calls: number; tokens: number }>();
      const uploadMap = new Map<string, { bytes: number }>();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dayStr = d.toLocaleDateString("en-US", { weekday: "short" });
        daysMap.set(dayStr, { calls: 0, tokens: 0 });
        uploadMap.set(dayStr, { bytes: 0 });
      }

      const usageHistoryRes = await supabaseAdmin
        .from("au_model_usage")
        .select("created_at,total_tokens,metadata")
        .gt("created_at", sevenDaysAgo);

      if (!usageHistoryRes.error) {
        for (const row of usageHistoryRes.data || []) {
          const dayStr = new Date((row as any).created_at).toLocaleDateString("en-US", { weekday: "short" });
          if (!daysMap.has(dayStr)) continue;
          const entry = daysMap.get(dayStr)!;
          entry.calls += 1;
          entry.tokens += Number((row as any).total_tokens || 0);
        }
      } else if (!isMissingTableLikeError(usageHistoryRes.error)) {
        await safeInsertDebugLog(supabaseAdmin, "get_analytics usageHistory query failed", {
          requestId,
          message: usageHistoryRes.error.message,
        });
      }

      const uploadHistoryRes = await supabaseAdmin
        .from("au_worker_jobs")
        .select("created_at,file_size_bytes")
        .gt("created_at", sevenDaysAgo);

      if (!uploadHistoryRes.error) {
        for (const row of uploadHistoryRes.data || []) {
          const dayStr = new Date((row as any).created_at).toLocaleDateString("en-US", { weekday: "short" });
          if (!uploadMap.has(dayStr)) continue;
          const entry = uploadMap.get(dayStr)!;
          entry.bytes += Number((row as any).file_size_bytes || 0);
        }
      } else if (!isMissingTableLikeError(uploadHistoryRes.error) && !isMissingColumnError(uploadHistoryRes.error)) {
        await safeInsertDebugLog(supabaseAdmin, "get_analytics uploadHistory query failed", {
          requestId,
          message: uploadHistoryRes.error.message,
        });
      }

      const apiCalls = Array.from(daysMap.entries()).map(([name, data]) => ({
        name,
        calls: data.calls,
        tokens: data.tokens,
      }));

      const storage = Array.from(uploadMap.entries()).map(([name, data]) => ({
        name,
        size: Number((data.bytes / (1024 * 1024)).toFixed(2)),
      }));

      let dbSizeBytes = 0;
      let activeConnections: number | string = "N/A";
      let dbStatsWarning: string | null = null;
      try {
        const dbStatsRes = await supabaseAdmin.rpc("au_admin_db_stats", { p_admin_token: adminToken });
        if (dbStatsRes.error) {
          throw dbStatsRes.error;
        }
        dbSizeBytes = Number((dbStatsRes.data as any)?.db_size_bytes || 0);
        activeConnections = (dbStatsRes.data as any)?.active_connections ?? "N/A";
      } catch (error: any) {
        dbStatsWarning = String(error?.message || "Unable to query DB stats");
      }

      const bytesFromUploads = storage.reduce((sum, day) => sum + Number(day.size || 0) * 1024 * 1024, 0);
      const totalStorage = formatStorageSizeFromBytes(Math.max(dbSizeBytes, bytesFromUploads));

      return new Response(
        JSON.stringify({
          ok: true,
          analytics: {
            rows: [
              { name: "Users", count: totalUsers || 0 },
              { name: "Docs", count: docCount || 0 },
              { name: "Chunks", count: chunkCount || 0 },
              { name: "Messages", count: msgCount || 0 },
              { name: "Usage Logs", count: usageCount || 0 },
            ],
            apiCalls,
            storage,
            stats: {
              totalStorage,
              totalRows: (totalUsers || 0) + (docCount || 0) + (chunkCount || 0) + (msgCount || 0) + (usageCount || 0),
              activeConnections,
            },
            diagnostics: {
              dbStatsWarning,
            },
          },
        }),
        { headers: corsHeaders },
      );
    }

    if (action === "get_debug_logs") {
      const { data: logs } = await supabaseAdmin
        .from("au_debug_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return new Response(JSON.stringify({ ok: true, logs }), { headers: corsHeaders });
    }

    if (action === "reload_schema") {
      const { error } = await supabaseAdmin.rpc("reload_schema_cache");
      if (error) {
        if (isMissingFunctionError(error)) {
          return new Response(
            JSON.stringify({
              ok: true,
              warning: "reload_schema_cache RPC is not installed.",
              details: error.message,
            }),
            { headers: corsHeaders },
          );
        }
        console.error("[admin-handler] Schema reload RPC failed:", error);
        return new Response(
          JSON.stringify({ error: "Failed to reload schema cache", details: error.message }),
          { status: 500, headers: corsHeaders },
        );
      }
      return new Response(JSON.stringify({ ok: true, message: "Schema reload signal sent" }), { headers: corsHeaders });
    }

    if (action === "verify_system") {
      const tables = [
        "au_admin_sessions",
        "au_admin_config",
        "au_admin_email_alerts",
        "au_key_groups",
        "au_api_keys",
        "au_models_registry",
        "au_pro_models_registry",
        "au_events",
        "au_model_usage",
        "au_worker_jobs",
        "au_document_chunks",
        "au_feedback",
      ];

      const results: Record<string, boolean> = {};
      const details: Record<string, string | null> = {};
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const { count, error } = await supabaseAdmin
          .from(table)
          .select("*", { count: "exact", head: true });
        if (!error) {
          results[table] = true;
          details[table] = null;
          counts[table] = Number(count || 0);
          continue;
        }

        if (isMissingTableLikeError(error)) {
          results[table] = false;
          details[table] = error.message || "Table missing";
          counts[table] = 0;
          continue;
        }

        // Non-missing-table errors are still reported for diagnosis,
        // but table existence is considered true.
        results[table] = true;
        details[table] = error.message || "Unknown table verification warning";
        counts[table] = 0;
      }

      return new Response(
        JSON.stringify({
          ok: true,
          results,
          details,
          counts,
        }),
        { headers: corsHeaders },
      );
    }

    return new Response(JSON.stringify({ 
      error: "Unknown action", 
      receivedAction: action,
      requestId 
    }), { status: 400, headers: corsHeaders });

  } catch (error: any) {
    if (error instanceof HttpError) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: "http_error",
          error: error.message,
          message: error.message,
          details: error.details ?? null,
          requestId,
        }),
        { status: error.status, headers: corsHeaders }
      );
    }

    console.error(`[admin-handler] Error [${requestId}]:`, error);
    
    // Log to DB for persistent tracking
    try {
      await supabaseAdmin.from("au_debug_logs").insert([{
        level: 'error',
        source: 'admin-handler',
        message: error.message || String(error),
        details: { requestId, stack: error.stack, body: body }
      }]);
    } catch (logErr) {
      console.error("[admin-handler] Failed to log error to DB:", logErr);
    }

    await triggerEmailAlert(supabaseAdmin, "critical_error", { error: error.message, requestId });
    return new Response(JSON.stringify({ 
      ok: false,
      code: "internal_server_error",
      error: error?.message || "Internal server error",
      message: error?.message || "Internal server error",
      details: {
        pgCode: error?.code || null,
        pgDetails: error?.details || null,
        hint: error?.hint || null,
        stack: error?.stack || null,
      },
      requestId 
    }), { status: 500, headers: corsHeaders });
  }
});
