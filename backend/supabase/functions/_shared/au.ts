// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Overridden by getCorsHeaders
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-upsert, x-admin-token, tus-resumable, upload-length, upload-metadata, upload-offset, x-device-id, x-supabase-client-platform",
};

function getSupabaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? Deno.env.get("MY_SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
}

function getSupabaseAnonKey(req?: Request): string {
  return (
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
    req?.headers.get("apikey") ??
    ""
  );
}

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const allowedOriginsEnv = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();

  const allowedOrigins = allowedOriginsEnv.length > 0
    ? allowedOriginsEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const allowsAny = allowedOrigins.includes("*") || allowedOrigins.length === 0; // Default to * if empty
  const isAllowed = !!origin && (allowsAny || allowedOrigins.includes(origin));

  const corsOrigin = isAllowed ? origin! : allowsAny ? "*" : (allowedOrigins[0] ?? "*");

  const headers: Record<string, string> = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": corsOrigin,
    "Vary": "Origin",
  };

  if (corsOrigin !== "*" && corsOrigin !== "") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  if (origin && !isAllowed && !allowsAny) {
    console.warn(`[cors] Origin not allowed: ${origin}. Allowed: ${allowedOrigins.join(", ") || "(none)"}`);
  }

  return headers;
}

export interface AuthResponse {
  user: any;
  userId: string | null;
  isAdmin: boolean;
  authError: string | null;
  ownershipFilter: { user_id: string } | null;
  supabaseClient: any;
  supabaseAdmin: any;
}

function isMissingProviderKeyTableError(error: any, table: string): boolean {
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

/**
 * Fetch with timeout helper
 */
export async function fetchWithTimeout(
  resource: string | URL | Request,
  options: RequestInit & { timeout?: number } = {}
) {
  const { timeout = 10000 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

function normalizeModelCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function textFromAny(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildAiUnavailableMessage(lastError: any): string {
  const status = Number(lastError?.status || 0);
  const message = String(lastError?.message || "").toLowerCase();
  const details = textFromAny(lastError?.details).toLowerCase();

  if (
    status === 404 &&
    (
      message.includes("model") && message.includes("not found") ||
      details.includes("modelnotfound") ||
      details.includes("model not found") ||
      details.includes("no endpoints found")
    )
  ) {
    return "All AI models are currently unavailable. The configured models appear deprecated or disabled on the provider.";
  }

  if (status === 401 || message.includes("401") || details.includes("unauthorized")) {
    return "All AI models are currently unavailable. AI provider authentication failed (401).";
  }

  if (status === 404) {
    return "All AI models are currently unavailable. AI provider routing returned 404.";
  }

  const raw = String(lastError?.message || "Exhausted all models");
  return `All AI models are currently unavailable. Last error: ${raw}`;
}

async function writeAiOutageLog(
  supabaseAdmin: any,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseAdmin.from("au_debug_logs").insert({
      level: "error",
      source: "ai-routing",
      message: "All AI models are currently unavailable",
      details: payload,
    });
  } catch {
  }
}

/**
 * Creates a Supabase client with service_role permissions.
 */
export function getServiceClient() {
  return createClient(
    getSupabaseUrl(),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
      ""
  );
}

/**
 * Validates authentication from request headers and body
 */
export async function validateAuth(req: Request, body?: any): Promise<AuthResponse> {
  const authHeader = req.headers.get("Authorization");
  const rawToken = authHeader
    ? authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice("bearer ".length).trim()
      : authHeader.trim()
    : "";
  
  const anonClient = createClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(req),
    { global: { headers: authHeader ? { Authorization: authHeader } : {} } }
  );

  let user: any = null;
  let userId: string | null = null;
  let isAdmin = false;
  let authError: string | null = null;

  if (authHeader && rawToken) {
    const token = rawToken;

    // 1. Try Supabase Auth/JWT first (Verifies Signature)
    try {
      const { data: authData, error: getUserError } = await anonClient.auth.getUser(token);
      if (getUserError) {
        authError = "Unauthorized: Invalid or expired access token";
      } else if (authData?.user) {
        user = authData.user;
        userId = authData.user.id;
        isAdmin = authData.user.app_metadata?.role === 'admin' || 
                  authData.user.user_metadata?.role === 'admin' ||
                  authData.user.role === 'service_role' ||
                  (authData.user as any).role === 'service_role';
        authError = null; 
      }
    } catch (err) {
      console.warn(`[shared-auth] auth.getUser() error:`, (err as Error).message);
      authError = "Unauthorized: Invalid or expired access token";
    }

    if (!userId) {
      // 2. Database-backed API Key check (for Service-to-Service)
      if (token && !token.includes('.')) {
        try {
          const supabaseAdmin = getServiceClient();
          let apiKeyData: { service?: string } | null = null;
          const providerKeyTables = ["au_api_keys", "ai_provider_keys"];
          for (const table of providerKeyTables) {
            const { data, error } = await supabaseAdmin
              .from(table)
              .select("service")
              .eq("key_value", token)
              .maybeSingle();
            if (!error) {
              apiKeyData = data;
              break;
            }
            if (!isMissingProviderKeyTableError(error, table)) {
              console.error(`[shared-auth] API key lookup failed on ${table}:`, error.message);
              break;
            }
          }
          
          if (apiKeyData) {
            isAdmin = true;
            userId = "00000000-0000-0000-0000-000000000000";
            user = { id: userId, role: "service_role", service: apiKeyData.service };
            authError = null;
          }
        } catch (e) {
          console.error("[shared-auth] Database API key check failed:", (e as Error).message);
        }
      }
    }
  }

  // REMOVED: Insecure Body Injection Fallbacks
  // REMOVED: Insecure Manual JWT Decode

  const ownershipFilter = userId ? { user_id: userId } : null;
  
  if (!userId) {
    console.warn("[shared-auth] No userId found in verified headers or API key");
  }

  return { 
    user, 
    userId, 
    isAdmin,
    authError,
    ownershipFilter,
    supabaseClient: anonClient, // Client with user context (if needed)
    supabaseAdmin: getServiceClient() // Service role client for bypassing RLS
  };
}

/**
 * Decides the auth executor for a user based on Supabase-authoritative logic
 */
/**
 * Enforces admin-only access
 * Throws a response error if not admin
 */
export async function requireAdmin(req: Request, body?: any) {
  const auth = await validateAuth(req, body);
  if (auth.authError) {
    const err = new Error(auth.authError) as any;
    err.status = 401;
    throw err;
  }
  if (!auth.isAdmin) {
    const err = new Error("Forbidden: Admin access required") as any;
    err.status = 403;
    throw err;
  }
  return auth;
}

/**
 * Enforces authenticated user access (no guests)
 */
export async function requireUser(req: Request, body?: any) {
  const auth = await validateAuth(req, body);
  if (auth.authError) {
    const err = new Error(auth.authError) as any;
    err.status = 401;
    throw err;
  }
  if (!auth.userId) {
    const err = new Error("Unauthorized: Authenticated session required") as any;
    err.status = 401;
    throw err;
  }
  return auth;
}

/**
 * Enforces any valid authenticated session
 */
export async function requireAnyAuth(req: Request, body?: any) {
  const auth = await validateAuth(req, body);
  if (auth.authError) {
    const err = new Error(auth.authError) as any;
    err.status = 401;
    throw err;
  }
  if (!auth.userId) {
    const err = new Error("Unauthorized: Authenticated session required") as any;
    err.status = 401;
    throw err;
  }
  return auth;
}

export interface AUResponse {
  text: string;
}

export async function generateEmbedding(
  supabaseAdmin: any,
  input: string,
  model?: string
): Promise<number[]> {
  const { openrouterEmbeddings } = await import("./openrouter.ts");
  const { getRotatingApiKey, reportModelHealth, reportKeyHealth } = await import("./model_registry.ts");
  const { ConfigService } = await import("./config_service.ts");

  const configService = ConfigService.getInstance(supabaseAdmin);
  const resolvedModel = model || await configService.getEmbeddingModelId();
  const apiKey = await configService.getRotatedKey('openrouter');

  try {
    const { embeddings } = await openrouterEmbeddings({
      supabaseAdmin,
      model: resolvedModel,
      input,
      apiKey,
    });

    if (!embeddings[0]) {
      throw new Error("Embedding generation failed: missing embedding in response");
    }

    // Report success
    reportModelHealth(resolvedModel, true, undefined, "embedding");
    // No explicit key reporting here unless we want to track by key string

    return embeddings[0];
  } catch (err: any) {
    const details = err.details || err.message;
    console.error(`[au.ts] generateEmbedding failed for model ${resolvedModel}:`, details);
    
    // Report failure
    reportModelHealth(resolvedModel, false, typeof err?.status === "number" ? err.status : undefined, "embedding");
    await reportKeyHealth(supabaseAdmin, apiKey, false, typeof err?.status === "number" ? err.status : undefined);

    const error = new Error(`Embedding failed (${resolvedModel}): ${details}`) as any;
    error.status = err.status || 500;
    error.isThrottled = err.isThrottled || false;
    throw error;
  }
}

type UsageContext = {
  userId?: string;
  feature?: string;
  sessionId?: string;
  ownershipFilter?: any;
  routedApiKey?: string | null;
  requestId?: string;
  correlationId?: string;
  cacheHit?: boolean;
  metadata?: Record<string, unknown>;
};

type UsageLogInput = {
  supabaseAdmin: any;
  context?: UsageContext;
  provider: string;
  model: string;
  usage?: any;
  success: boolean;
  latencyMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

type NormalizedUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
};

function normalizeUsagePayload(usage: any): NormalizedUsage {
  const promptTokens = Number(
    usage?.prompt_tokens ??
      usage?.input_tokens ??
      usage?.promptTokens ??
      0,
  ) || 0;
  const completionTokens = Number(
    usage?.completion_tokens ??
      usage?.output_tokens ??
      usage?.completionTokens ??
      0,
  ) || 0;
  const totalTokens = Number(
    usage?.total_tokens ??
      usage?.totalTokens ??
      promptTokens + completionTokens,
  ) || 0;
  const costRaw =
    usage?.total_cost ??
    usage?.cost ??
    usage?.cost_usd ??
    null;
  const costUsd = costRaw == null ? null : Number(costRaw);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: Number.isFinite(costUsd as number) ? (costUsd as number) : null,
  };
}

async function logModelUsage(input: UsageLogInput): Promise<void> {
  const feature = String(input.context?.feature || "").trim();
  if (!feature) return;

  const explicitUserId = String(input.context?.userId || "").trim();
  const fallbackUserId = String(input.context?.ownershipFilter?.user_id || "").trim();
  const userId = explicitUserId || fallbackUserId || null;
  if (!userId) return;

  const normalized = normalizeUsagePayload(input.usage || {});
  const model = String(input.model || "").trim() || "unknown";
  const provider = String(input.provider || "").trim() || "unknown";
  const latencyMs = Number.isFinite(Number(input.latencyMs))
    ? Math.max(0, Math.round(Number(input.latencyMs)))
    : null;
  const errorText = input.error ? String(input.error).slice(0, 1200) : null;

  const metadata = {
    ...(input.context?.metadata || {}),
    ...(input.metadata || {}),
    cache_hit: input.context?.cacheHit === true,
    usage: input.usage || null,
  };

  const payload: Record<string, unknown> = {
    user_id: userId,
    feature,
    provider,
    model,
    model_id: model,
    prompt_tokens: normalized.promptTokens,
    completion_tokens: normalized.completionTokens,
    total_tokens: normalized.totalTokens,
    cost_usd: normalized.costUsd,
    cost: normalized.costUsd,
    success: input.success === true,
    latency_ms: latencyMs,
    request_id: input.context?.requestId || input.context?.sessionId || null,
    correlation_id: input.context?.correlationId || null,
    error: errorText,
    metadata,
  };

  const { error } = await input.supabaseAdmin
    .from("au_model_usage")
    .insert([payload]);
  if (error) {
    console.error("[au.ts] Failed to log usage row:", error.message);
  }
}

export async function logModelUsageEvent(input: UsageLogInput): Promise<void> {
  try {
    await logModelUsage(input);
  } catch (error: any) {
    console.error("[au.ts] logModelUsageEvent failed:", String(error?.message || error));
  }
}

export type AUChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

function sanitizeChatMessages(messages: AUChatMessage[]): AUChatMessage[] {
  return messages
    .map((message) => ({
      role: message.role === "assistant" || message.role === "tool" || message.role === "system"
        ? message.role
        : "user",
      content: String(message.content || "").trim(),
    }))
    .filter((message) => message.content.length > 0);
}

async function callAUInternal(
  supabaseAdmin: any,
  messages: AUChatMessage[],
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: UsageContext,
  scope = "chat"
): Promise<string> {
  const {
    openrouterChatCompletions,
    listAvailableUserModelIds,
    getEmergencyModelCandidates,
    isModelNotFoundError,
    fallbackChatCompletions,
  } = await import("./openrouter.ts");
  const { getAURequestConfig, reportModelHealth, reportKeyHealth } = await import("./model_registry.ts");
  const { getServicePolicy } = await import("./gating.ts");
  
  // 1. Determine Allowed Models (Policy)
  if (!usageContext?.userId) {
    const err = new Error("Unauthorized: Authenticated session required") as any;
    err.status = 401;
    throw err;
  }
  const policy = await getServicePolicy(supabaseAdmin, usageContext.userId);
  const allowedModels: string[] = normalizeModelCandidates(policy.allowed_models);
  const tier: 'free' | 'pro' = policy.tier;
  let candidateModels: string[] = [...allowedModels];

  if (candidateModels.length === 0) {
    const err = new Error("No allowed models configured for this user tier.") as any;
    err.status = 503;
    throw err;
  }

  // Honor explicit model override if policy allows it.
  const routedModel = typeof modelOverride === "string" ? modelOverride.trim() : "";
  if (routedModel) {
    candidateModels = [routedModel, ...candidateModels.filter((id) => id !== routedModel)];
  }

  const MAX_ATTEMPTS = 6;
  let attempts = 0;
  let lastError: any = null;
  let lastAttemptedModel = "";
  let lastAttemptedProvider = "openrouter";
  const triedModels = new Set<string>();
  let usedEmergencyModelPool = false;
  let fallbackProviderUsed = false;

  while (attempts < MAX_ATTEMPTS) {
    let config: { modelId: string; apiKey: string };
    try {
      config = await getAURequestConfig(supabaseAdmin, Array.from(triedModels), scope, tier);
    } catch (configErr: any) {
      lastError = configErr;
      console.error("[au.ts] Failed to resolve model/key config:", configErr?.message || configErr);
      break;
    }

    const currentApiKey =
      typeof usageContext?.routedApiKey === "string" && usageContext.routedApiKey.trim().length > 0
        ? usageContext.routedApiKey.trim()
        : config.apiKey;
    let currentModel = config.modelId;
    if (!currentModel || !candidateModels.includes(currentModel) || triedModels.has(currentModel)) {
      currentModel =
        candidateModels.find((id) => !triedModels.has(id)) ||
        candidateModels[0];
    }

    if (!currentModel && currentApiKey) {
      const availableIds = await listAvailableUserModelIds(currentApiKey, usageContext?.sessionId);
      const emergency = getEmergencyModelCandidates(availableIds, tier);
      if (emergency.length > 0) {
        candidateModels = emergency;
        usedEmergencyModelPool = true;
        currentModel = candidateModels[0];
      }
    }

    if (!currentModel) {
      const err = new Error("No routable models are available for this user/account.") as any;
      err.status = 503;
      lastError = err;
      break;
    }

    const currentFallbackList = [
      currentModel,
      ...candidateModels.filter((m) => m !== currentModel && !triedModels.has(m)),
    ];

    triedModels.add(currentModel);

    try {
      console.log(`[au.ts][${scope}] Attempt ${attempts + 1}/${MAX_ATTEMPTS} | Model: ${currentModel} | Fallbacks: ${currentFallbackList.length}`);
      lastAttemptedModel = currentModel;
      const callStartedAt = Date.now();
      
      const { content, usage, raw } = await openrouterChatCompletions({
        supabaseAdmin,
        model: currentModel,
        models: currentFallbackList,
        apiKey: currentApiKey,
        messages,
        temperature,
        response_format: jsonMode ? { type: "json_object" } : undefined,
        requestId: usageContext?.sessionId,
      });

      // Report success for health scoring
      reportModelHealth(currentModel, true, undefined, scope);
      await logModelUsage({
        supabaseAdmin,
        context: usageContext,
        provider: "openrouter",
        model: String(raw?.model || currentModel),
        usage,
        success: true,
        latencyMs: Date.now() - callStartedAt,
        metadata: {
          scope,
          emergencyPool: usedEmergencyModelPool,
          fallbackProviderUsed: false,
        },
      });

      return content;

    } catch (err: any) {
      const status = err.status;
      const message = err.message || String(err);
      console.warn(`[au.ts][${scope}] Model ${currentModel} failed (Status: ${status}): ${message}`);
      lastError = err;

      reportModelHealth(currentModel, false, typeof err?.status === "number" ? err.status : undefined, scope);
      await reportKeyHealth(supabaseAdmin, currentApiKey, false, typeof err?.status === "number" ? err.status : undefined);
      
      if (status === 404 && isModelNotFoundError(err)) {
        const availableIds = await listAvailableUserModelIds(currentApiKey, usageContext?.sessionId);
        const policySafeCandidates = candidateModels.filter((id) => availableIds.includes(id));
        if (policySafeCandidates.length > 0) {
          candidateModels = policySafeCandidates;
        } else {
          const emergency = getEmergencyModelCandidates(availableIds, tier);
          if (emergency.length > 0) {
            candidateModels = emergency;
            usedEmergencyModelPool = true;
            console.warn(`[au.ts] Policy model set unavailable; switching to emergency model pool (${candidateModels.length}).`);
          }
        }
      }

      attempts++;
    }
  }

  // Provider fallback (OpenAI-compatible) when OpenRouter path is exhausted.
  try {
    const fallbackStartedAt = Date.now();
    const fallback = await fallbackChatCompletions({
      messages,
      temperature,
      response_format: jsonMode ? { type: "json_object" } : undefined,
      requestId: usageContext?.sessionId,
    });
    fallbackProviderUsed = true;

    lastAttemptedProvider = fallback.provider || "openai-compatible";
    lastAttemptedModel = fallback.model || lastAttemptedModel || "unknown";
    await logModelUsage({
      supabaseAdmin,
      context: usageContext,
      provider: lastAttemptedProvider,
      model: lastAttemptedModel,
      usage: fallback.usage,
      success: true,
      latencyMs: Date.now() - fallbackStartedAt,
      metadata: {
        scope,
        fallbackFrom: "openrouter",
        emergencyPool: usedEmergencyModelPool,
      },
    });

    console.warn("[au.ts] Served response via fallback provider after OpenRouter exhaustion.");
    return fallback.content;
  } catch (fallbackErr: any) {
    if (!lastError) lastError = fallbackErr;
    console.error("[au.ts] Fallback provider failed:", fallbackErr?.message || fallbackErr);
  }

  const userMessage = buildAiUnavailableMessage(lastError);
  const finalError = new Error(userMessage) as any;
  finalError.status = 503;
  finalError.details = {
    lastErrorMessage: String(lastError?.message || "Exhausted all models"),
    lastErrorStatus: Number(lastError?.status || 0) || null,
    lastErrorDetails: lastError?.details ?? null,
    triedModels: Array.from(triedModels),
    usedEmergencyModelPool,
    fallbackProviderUsed,
  };
  finalError.isThrottled = [429, 502, 503, 504].includes(Number(lastError?.status));

  await writeAiOutageLog(supabaseAdmin, {
    scope,
    userId: usageContext?.userId || null,
    feature: usageContext?.feature || null,
    triedModels: Array.from(triedModels),
    usedEmergencyModelPool,
    fallbackProviderUsed,
    lastErrorMessage: String(lastError?.message || "unknown"),
    lastErrorStatus: Number(lastError?.status || 0) || null,
    lastErrorDetails: lastError?.details ?? null,
  });

  await logModelUsage({
    supabaseAdmin,
    context: usageContext,
    provider: lastAttemptedProvider,
    model: lastAttemptedModel || "unknown",
    usage: null,
    success: false,
    error: String(lastError?.message || userMessage),
    metadata: {
      scope,
      stream: false,
      triedModels: Array.from(triedModels),
      usedEmergencyModelPool,
      fallbackProviderUsed,
      failureDetails: lastError?.details ?? null,
    },
  });

  throw finalError;
}

export async function callAU(
  supabaseAdmin: any,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: UsageContext,
  scope = "chat"
): Promise<string> {
  return await callAUInternal(
    supabaseAdmin,
    sanitizeChatMessages([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]),
    temperature,
    jsonMode,
    modelOverride,
    usageContext,
    scope,
  );
}

export async function callAUMessages(
  supabaseAdmin: any,
  messages: AUChatMessage[],
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: UsageContext,
  scope = "chat"
): Promise<string> {
  return await callAUInternal(
    supabaseAdmin,
    sanitizeChatMessages(messages),
    temperature,
    jsonMode,
    modelOverride,
    usageContext,
    scope,
  );
}

async function callAUStreamInternal(
  supabaseAdmin: any,
  messages: AUChatMessage[],
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: UsageContext,
  scope = "chat",
  requestId?: string
): Promise<{ response: Response; model: string }> {
  const {
    openrouterChatCompletionsStream,
    listAvailableUserModelIds,
    getEmergencyModelCandidates,
    isModelNotFoundError,
    fallbackChatCompletions,
    buildSyntheticSseResponseFromText,
  } = await import("./openrouter.ts");
  const { getAURequestConfig, reportModelHealth, reportKeyHealth } = await import("./model_registry.ts");
  const { getServicePolicy } = await import("./gating.ts");
  if (!usageContext?.userId) {
    const err = new Error("Unauthorized: Authenticated session required") as any;
    err.status = 401;
    throw err;
  }
  const policy = await getServicePolicy(supabaseAdmin, usageContext.userId);
  const allowedModels: string[] = normalizeModelCandidates(policy.allowed_models);
  const tier: 'free' | 'pro' = policy.tier;
  let candidateModels: string[] = [...allowedModels];

  if (candidateModels.length === 0) {
    const err = new Error("No allowed models configured for this user tier.") as any;
    err.status = 503;
    throw err;
  }

  const routedModel = typeof modelOverride === "string" ? modelOverride.trim() : "";
  if (routedModel) {
    candidateModels = [routedModel, ...candidateModels.filter((id) => id !== routedModel)];
  }

  const MAX_ATTEMPTS = 6;
  let attempts = 0;
  let lastError: any = null;
  let lastAttemptedModel = "";
  let lastAttemptedProvider = "openrouter";
  const triedModels = new Set<string>();
  let usedEmergencyModelPool = false;
  let fallbackProviderUsed = false;

  while (attempts < MAX_ATTEMPTS) {
    let config: { modelId: string; apiKey: string };
    try {
      config = await getAURequestConfig(supabaseAdmin, Array.from(triedModels), scope, tier);
    } catch (configErr: any) {
      lastError = configErr;
      console.error("[au.ts] Failed to resolve streaming model/key config:", configErr?.message || configErr);
      break;
    }

    const currentApiKey =
      typeof usageContext?.routedApiKey === "string" && usageContext.routedApiKey.trim().length > 0
        ? usageContext.routedApiKey.trim()
        : config.apiKey;
    let currentModel = config.modelId;
    if (!currentModel || !candidateModels.includes(currentModel) || triedModels.has(currentModel)) {
      currentModel =
        candidateModels.find((id) => !triedModels.has(id)) ||
        candidateModels[0];
    }

    if (!currentModel && currentApiKey) {
      const availableIds = await listAvailableUserModelIds(currentApiKey, requestId);
      const emergency = getEmergencyModelCandidates(availableIds, tier);
      if (emergency.length > 0) {
        candidateModels = emergency;
        usedEmergencyModelPool = true;
        currentModel = candidateModels[0];
      }
    }

    if (!currentModel) {
      const err = new Error("No routable models are available for streaming.") as any;
      err.status = 503;
      lastError = err;
      break;
    }

    const currentFallbackList = [
      currentModel,
      ...candidateModels.filter((m) => m !== currentModel && !triedModels.has(m)),
    ];
    triedModels.add(currentModel);

    try {
      const streamStartedAt = Date.now();
      lastAttemptedModel = currentModel;
      const resp = await openrouterChatCompletionsStream({
        supabaseAdmin,
        model: currentModel,
        models: currentFallbackList,
        apiKey: currentApiKey,
        messages,
        temperature,
        response_format: jsonMode ? { type: "json_object" } : undefined,
        requestId,
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => "");
        const err = new Error(`OpenRouter API Error: ${resp.status}`) as any;
        err.status = resp.status;
        err.details = errorText;
        err.isThrottled = resp.status === 429 || resp.status === 503;
        throw err;
      }

      reportModelHealth(currentModel, true, undefined, scope);
      await logModelUsage({
        supabaseAdmin,
        context: usageContext,
        provider: "openrouter",
        model: currentModel,
        usage: null,
        success: true,
        latencyMs: Date.now() - streamStartedAt,
        metadata: {
          scope,
          stream: true,
          emergencyPool: usedEmergencyModelPool,
        },
      });
      return { response: resp, model: currentModel };
    } catch (err: any) {
      const status = err?.status;
      const message = err?.message || String(err);
      console.warn(`[au.ts][${scope}] Streaming model ${currentModel} failed (Status: ${status}): ${message}`);
      lastError = err;

      reportModelHealth(currentModel, false, typeof err?.status === "number" ? err.status : undefined, scope);
      await reportKeyHealth(supabaseAdmin, currentApiKey, false, typeof err?.status === "number" ? err.status : undefined);

      if (status === 404 && isModelNotFoundError(err)) {
        const availableIds = await listAvailableUserModelIds(currentApiKey, requestId);
        const policySafeCandidates = candidateModels.filter((id) => availableIds.includes(id));
        if (policySafeCandidates.length > 0) {
          candidateModels = policySafeCandidates;
        } else {
          const emergency = getEmergencyModelCandidates(availableIds, tier);
          if (emergency.length > 0) {
            candidateModels = emergency;
            usedEmergencyModelPool = true;
            console.warn(`[au.ts] Streaming switched to emergency model pool (${candidateModels.length}).`);
          }
        }
      }

      attempts++;
    }
  }

  try {
    const fallbackStartedAt = Date.now();
    const fallback = await fallbackChatCompletions({
      messages,
      temperature,
      response_format: jsonMode ? { type: "json_object" } : undefined,
      requestId,
    });
    fallbackProviderUsed = true;
    lastAttemptedProvider = fallback.provider || "openai-compatible";
    lastAttemptedModel = fallback.model || lastAttemptedModel || "unknown";
    await logModelUsage({
      supabaseAdmin,
      context: usageContext,
      provider: lastAttemptedProvider,
      model: lastAttemptedModel,
      usage: fallback.usage,
      success: true,
      latencyMs: Date.now() - fallbackStartedAt,
      metadata: {
        scope,
        stream: true,
        syntheticSse: true,
        fallbackFrom: "openrouter",
      },
    });
    const syntheticResponse = buildSyntheticSseResponseFromText(fallback.content);
    console.warn("[au.ts] Streaming served via fallback provider (synthetic SSE).");
    return { response: syntheticResponse, model: fallback.model };
  } catch (fallbackErr: any) {
    if (!lastError) lastError = fallbackErr;
    console.error("[au.ts] Streaming fallback provider failed:", fallbackErr?.message || fallbackErr);
  }

  const finalError = new Error(buildAiUnavailableMessage(lastError)) as any;
  finalError.status = 503;
  finalError.details = {
    lastErrorMessage: String(lastError?.message || "Exhausted all models"),
    lastErrorStatus: Number(lastError?.status || 0) || null,
    lastErrorDetails: lastError?.details ?? null,
    triedModels: Array.from(triedModels),
    usedEmergencyModelPool,
    fallbackProviderUsed,
  };
  finalError.isThrottled = [429, 502, 503, 504].includes(Number(lastError?.status));

  await writeAiOutageLog(supabaseAdmin, {
    scope,
    requestId: requestId || null,
    userId: usageContext?.userId || null,
    feature: usageContext?.feature || null,
    stream: true,
    triedModels: Array.from(triedModels),
    usedEmergencyModelPool,
    fallbackProviderUsed,
    lastErrorMessage: String(lastError?.message || "unknown"),
    lastErrorStatus: Number(lastError?.status || 0) || null,
    lastErrorDetails: lastError?.details ?? null,
  });

  await logModelUsage({
    supabaseAdmin,
    context: usageContext,
    provider: lastAttemptedProvider,
    model: lastAttemptedModel || "unknown",
    usage: null,
    success: false,
    error: String(lastError?.message || finalError.message),
    metadata: {
      scope,
      stream: true,
      triedModels: Array.from(triedModels),
      usedEmergencyModelPool,
      fallbackProviderUsed,
      failureDetails: lastError?.details ?? null,
    },
  });

  throw finalError;
}

export async function callAUStream(
  supabaseAdmin: any,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: UsageContext,
  scope = "chat",
  requestId?: string
): Promise<{ response: Response; model: string }> {
  return await callAUStreamInternal(
    supabaseAdmin,
    sanitizeChatMessages([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]),
    temperature,
    jsonMode,
    modelOverride,
    usageContext,
    scope,
    requestId,
  );
}

export async function callAUStreamMessages(
  supabaseAdmin: any,
  messages: AUChatMessage[],
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: UsageContext,
  scope = "chat",
  requestId?: string
): Promise<{ response: Response; model: string }> {
  return await callAUStreamInternal(
    supabaseAdmin,
    sanitizeChatMessages(messages),
    temperature,
    jsonMode,
    modelOverride,
    usageContext,
    scope,
    requestId,
  );
}

/**
 * Standardized Event Emission for the Sync Layer
 */
export async function emitEvent(
  supabaseAdmin: any,
  event: {
    event_type: 'document_uploaded' | 'document_deleted' | 'embedding_created' | 'vector_indexed' | 'chat_completed' | 'exam_generated' | 'prediction_generated';
    entity_id: string;
    user_id?: string | null;
    metadata?: any;
  }
) {
  const payload = {
    ...event,
    user_id: event.user_id ?? null,
    timestamp: new Date().toISOString(),
  };

  // 1. Persist to DB
  const { error } = await supabaseAdmin
    .from('au_events')
    .insert([payload]);

  if (error) {
    console.error(`[sync-layer] Failed to persist event ${event.event_type}:`, error.message);
  }

  // 2. Realtime Broadcast (Optional but recommended for frontend sync)
  // This would use Supabase Realtime Broadcast if configured
  
  return { success: !error, payload };
}
