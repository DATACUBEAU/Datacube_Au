import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  enforceLimitOrThrow,
  getEffectiveLimitsForUser,
  getLimitsFlags,
  incrementUsageCounters,
  readLimit,
  readUsageValue,
  touchUserActivity,
} from "./limits.ts";

export type UsageFeature = "au_chat" | "practice_exams" | "predictions" | "knowledge_generate" | "docs_stored";

export class LimitExceededError extends Error {
  public context: Record<string, unknown>;
  constructor(context: Record<string, unknown>) {
    super("LIMIT_EXCEEDED");
    this.name = "LimitExceededError";
    this.context = context;
  }
}

export class ProRequiredError extends Error {
  public context: Record<string, unknown>;
  constructor(context: Record<string, unknown>) {
    super("PRO_REQUIRED");
    this.name = "ProRequiredError";
    this.context = context;
  }
}

const PROMO_END_UTC_MS = new Date('2026-04-01T23:00:00.000Z').getTime();

export async function requireProEntitlementOrThrow(
  supabaseClient: SupabaseClient,
  userId: string,
  featureKey: string,
): Promise<void> {
  if (!userId) {
    throw new ProRequiredError({
      error: "PRO_REQUIRED",
      key: featureKey,
      message: "This feature requires Pro.",
      upgrade: { cta: "Upgrade to Pro", href: `/pricing?source=feature_${featureKey}` },
    });
  }

  const nowIso = new Date().toISOString();
  const promoActive = Date.now() < PROMO_END_UTC_MS;

  try {
    const { data, error } = await supabaseClient.rpc("get_effective_entitlements", {
      p_user_id: userId,
    });
    if (!error && data && (data as any).has_pro === true) {
      return;
    }
  } catch {
  }

  if (!promoActive) {
    const { data, error } = await supabaseClient
      .from("entitlement_grants")
      .select("id")
      .eq("user_id", userId)
      .eq("entitlement", "pro")
      .eq("status", "active")
      .lte("starts_at", nowIso)
      .gte("ends_at", nowIso)
      .limit(1);

    if (!error && (data || []).length > 0) {
      return;
    }
  } else {
    return;
  }

  throw new ProRequiredError({
    error: "PRO_REQUIRED",
    key: featureKey,
    message: "This feature is available on Pro. Upgrade to continue.",
    upgrade: { cta: "Upgrade to Pro", href: `/pricing?source=feature_${featureKey}` },
  });
}

export async function consumeUsageOrThrow(
  supabaseClient: SupabaseClient,
  userId: string,
  feature: UsageFeature,
  opts?: { countInc?: number; mbInc?: number },
): Promise<void> {
  const countInc = Number.isFinite(opts?.countInc) ? Number(opts?.countInc) : 1;
  const mbInc = Number.isFinite(opts?.mbInc) ? Number(opts?.mbInc) : 0;

  const [state, flags] = await Promise.all([
    getEffectiveLimitsForUser(supabaseClient, userId),
    getLimitsFlags(supabaseClient),
  ]);

  const usageTotal = state.usage?.total || {};
  const resetAt = state.reset_at || state.usage?.reset_at || null;

  try {
    if (feature === "docs_stored") {
      enforceLimitOrThrow({
        enforcementEnabled: flags.enforcementEnabled,
        limitKey: "max_uploads_total",
        current: readUsageValue(usageTotal, ["used_uploads", "uploads_count"], 0),
        increment: countInc,
        max: readLimit(state.limits, "max_uploads_total", -1),
        resetAt,
      });

      enforceLimitOrThrow({
        enforcementEnabled: flags.enforcementEnabled,
        limitKey: "max_storage_mb",
        current: readUsageValue(usageTotal, ["used_storage_mb", "uploaded_mb"], 0),
        increment: mbInc,
        max: readLimit(state.limits, "max_storage_mb", -1),
        resetAt,
      });
    } else if (feature === "au_chat") {
      enforceLimitOrThrow({
        enforcementEnabled: flags.enforcementEnabled,
        limitKey: "max_chats_total",
        current: readUsageValue(usageTotal, ["used_chats", "messages_count"], 0),
        increment: countInc,
        max: readLimit(state.limits, "max_chats_total", -1),
        resetAt,
      });
    } else if (feature === "predictions") {
      enforceLimitOrThrow({
        enforcementEnabled: flags.enforcementEnabled,
        limitKey: "max_exam_predictions",
        current: readUsageValue(usageTotal, ["max_exam_predictions", "prediction_generations", "used_exams", "exams_count"], 0),
        increment: countInc,
        max: readLimit(state.limits, "max_exam_predictions", -1),
        resetAt,
      });
    } else if (feature === "practice_exams") {
      enforceLimitOrThrow({
        enforcementEnabled: flags.enforcementEnabled,
        limitKey: "max_practice_exams",
        current: readUsageValue(usageTotal, ["max_practice_exams", "practice_exam_generations"], 0),
        increment: countInc,
        max: readLimit(state.limits, "max_practice_exams", -1),
        resetAt,
      });
    } else if (feature === "knowledge_generate") {
      enforceLimitOrThrow({
        enforcementEnabled: flags.enforcementEnabled,
        limitKey: "max_knowledge_hub",
        current: readUsageValue(usageTotal, ["max_knowledge_hub", "knowledge_generations"], 0),
        increment: countInc,
        max: readLimit(state.limits, "max_knowledge_hub", -1),
        resetAt,
      });
    } else {
      enforceLimitOrThrow({
        enforcementEnabled: flags.enforcementEnabled,
        limitKey: "max_exam_predictions",
        current: readUsageValue(usageTotal, ["max_exam_predictions", "prediction_generations", "used_exams", "exams_count"], 0),
        increment: countInc,
        max: readLimit(state.limits, "max_exam_predictions", -1),
        resetAt,
      });
    }
  } catch (error: any) {
    if (error?.name === "LimitExceededError" || error?.message === "LIMIT_EXCEEDED") {
      throw new LimitExceededError({
        code: "LIMIT_EXCEEDED",
        ...(error?.payload || {}),
      });
    }
    throw error;
  }

  if (feature === "docs_stored") {
    await incrementUsageCounters(supabaseClient, userId, {
      used_uploads: countInc,
      uploads_count: countInc,
      used_storage_mb: mbInc,
      uploaded_mb: mbInc,
    });
    await touchUserActivity(supabaseClient, userId, "activity");
    return;
  }

  if (feature === "au_chat") {
    await incrementUsageCounters(supabaseClient, userId, {
      used_chats: countInc,
      messages_count: countInc,
    });
    await touchUserActivity(supabaseClient, userId, "activity");
    return;
  }

  if (feature === "predictions") {
    await incrementUsageCounters(supabaseClient, userId, {
      max_exam_predictions: countInc,
      prediction_generations: countInc,
      used_exams: countInc,
      exams_count: countInc,
    });
    await touchUserActivity(supabaseClient, userId, "activity");
    return;
  }

  if (feature === "practice_exams") {
    await incrementUsageCounters(supabaseClient, userId, {
      max_practice_exams: countInc,
      practice_exam_generations: countInc,
    });
    await touchUserActivity(supabaseClient, userId, "activity");
    return;
  }

  if (feature === "knowledge_generate") {
    await incrementUsageCounters(supabaseClient, userId, {
      max_knowledge_hub: countInc,
      knowledge_generations: countInc,
    });
    await touchUserActivity(supabaseClient, userId, "activity");
    return;
  }

  await incrementUsageCounters(supabaseClient, userId, {
    max_exam_predictions: countInc,
    prediction_generations: countInc,
    used_exams: countInc,
    exams_count: countInc,
  });
  await touchUserActivity(supabaseClient, userId, "activity");
}
