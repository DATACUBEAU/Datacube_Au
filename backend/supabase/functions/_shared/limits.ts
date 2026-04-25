import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type LimitsFlags = {
  alertsEnabled: boolean;
  alertsThresholds: { warn: number[]; block: number[] };
  alertsCooldownMinutes: number;
  enforcementEnabled: boolean;
  upsellEnabled: boolean;
};

export type EffectiveLimitsPayload = {
  plan: string;
  entitlement_source?: string;
  retention_days?: number;
  limits: Record<string, unknown>;
  usage: {
    today: Record<string, number>;
    total?: Record<string, number>;
    reset_at?: string;
  };
  reset_at?: string;
};

export class LimitExceededError extends Error {
  status: number;
  payload: Record<string, unknown>;
  constructor(payload: Record<string, unknown>) {
    super("LIMIT_EXCEEDED");
    this.name = "LimitExceededError";
    this.status = 429;
    this.payload = payload;
  }
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeCanonicalLimitAliases(limits: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...limits };
  if (typeof normalized.max_file_mb === "undefined" && typeof normalized.max_file_size_mb !== "undefined") {
    normalized.max_file_mb = normalized.max_file_size_mb;
  }
  if (typeof normalized.max_jobs_concurrent === "undefined" && typeof normalized.max_concurrent_jobs !== "undefined") {
    normalized.max_jobs_concurrent = normalized.max_concurrent_jobs;
  }
  return normalized;
}

export async function getEffectiveLimitsForUser(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<EffectiveLimitsPayload> {
  const { data, error } = await supabaseAdmin.rpc("get_effective_limits", { p_user_id: userId });
  if (error) throw error;

  const payload = asObject(data);
  const usage = asObject(payload.usage);

  return {
    plan: typeof payload.plan === "string" ? payload.plan : "free",
    entitlement_source: typeof payload.entitlement_source === "string" ? payload.entitlement_source : undefined,
    retention_days: Number.isFinite(Number(payload.retention_days)) ? Math.max(1, Math.floor(Number(payload.retention_days))) : undefined,
    limits: normalizeCanonicalLimitAliases(asObject(payload.limits)),
    usage: {
      today: asObject(usage.today) as Record<string, number>,
      total: asObject(usage.total) as Record<string, number>,
      reset_at: typeof usage.reset_at === "string" ? usage.reset_at : undefined,
    },
    reset_at: typeof payload.reset_at === "string" ? payload.reset_at : undefined,
  };
}

export async function getLimitsFlags(supabaseAdmin: SupabaseClient): Promise<LimitsFlags> {
  const { data } = await supabaseAdmin
    .from("feature_flags")
    .select("key,enabled,config")
    .in("key", [
      "limits.alerts.enabled",
      "limits.alerts.thresholds",
      "limits.alerts.cooldown_minutes",
      "limits.enforcement.enabled",
      "limits.ui.upsell.enabled",
    ]);

  const map = new Map<string, any>();
  for (const row of data || []) {
    map.set(String((row as any)?.key || ""), row);
  }

  const thresholdsConfig = asObject(map.get("limits.alerts.thresholds")?.config);
  const warn = Array.isArray(thresholdsConfig.warn)
    ? thresholdsConfig.warn.map((v) => asNumber(v)).filter((v) => v > 0)
    : [70, 90];
  const block = Array.isArray(thresholdsConfig.block)
    ? thresholdsConfig.block.map((v) => asNumber(v)).filter((v) => v > 0)
    : [100];

  const cooldownConfig = asObject(map.get("limits.alerts.cooldown_minutes")?.config);
  const cooldownMinutes = Math.max(1, Math.floor(asNumber(cooldownConfig.minutes, 20)));

  return {
    alertsEnabled: map.get("limits.alerts.enabled")?.enabled !== false,
    alertsThresholds: { warn, block },
    alertsCooldownMinutes: cooldownMinutes,
    enforcementEnabled: map.get("limits.enforcement.enabled")?.enabled !== false,
    upsellEnabled: map.get("limits.ui.upsell.enabled")?.enabled !== false,
  };
}

export async function incrementUsageCounters(
  supabaseAdmin: SupabaseClient,
  userId: string,
  increments: Record<string, number>,
): Promise<void> {
  const payload = Object.entries(increments).reduce((acc, [key, value]) => {
    if (!Number.isFinite(value)) return acc;
    acc[key] = value;
    return acc;
  }, {} as Record<string, number>);

  if (Object.keys(payload).length === 0) return;

  const { error } = await supabaseAdmin.rpc("increment_usage_counters", {
    p_user_id: userId,
    p_increments: payload,
    p_day: new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
}

export function enforceLimitOrThrow(params: {
  enforcementEnabled: boolean;
  limitKey: string;
  current: number;
  increment?: number;
  max: number;
  resetAt?: string | null;
  context?: Record<string, unknown>;
}): void {
  if (!params.enforcementEnabled) return;

  const increment = Number.isFinite(params.increment) ? Number(params.increment) : 0;
  const projected = params.current + increment;
  if (!Number.isFinite(params.max) || params.max <= 0) return;
  if (projected <= params.max) return;

  throw new LimitExceededError({
    code: "LIMIT_EXCEEDED",
    limit: params.limitKey,
    current: params.current,
    max: params.max,
    reset_at: params.resetAt || null,
    ...params.context,
  });
}

export function readLimit(limits: Record<string, unknown>, key: string, fallback: number): number {
  const raw = limits[key];
  if (raw === null || typeof raw === "undefined") return -1;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "unlimited") return -1;
  const value = asNumber(raw, fallback);
  if (!Number.isFinite(value)) return fallback;
  return value < 0 ? -1 : value;
}

export function readUsageValue(
  usage: Record<string, unknown> | undefined,
  keys: string[],
  fallback = 0,
): number {
  const source = usage || {};
  for (const key of keys) {
    const raw = source[key];
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export async function touchUserActivity(
  supabaseAdmin: SupabaseClient,
  userId: string,
  event: "activity" | "sign_in" | "sign_out" | "session_end" = "activity",
): Promise<void> {
  try {
    await supabaseAdmin.rpc("record_user_activity", {
      p_user_id: userId,
      p_event: event,
      p_metadata: {},
    });
  } catch {
  }
}
