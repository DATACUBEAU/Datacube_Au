import { getCorsHeaders, requireUser } from "../_shared/au.ts";
import { openrouterChatCompletions } from "../_shared/openrouter.ts";
import { getServicePolicy } from "../_shared/gating.ts";
import { getAURequestConfig } from "../_shared/model_registry.ts";
import { consumeUsageOrThrow, LimitExceededError } from "../_shared/usage-guard.ts";
import { usageTrackingHandledByProxy } from "../_shared/usage-tracking.ts";

type ChatRole = "system" | "user" | "assistant" | "tool";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

function isChatMessageArray(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value)) return false;
  return value.every((m) => {
    if (!m || typeof m !== "object") return false;
    const role = (m as any).role;
    const content = (m as any).content;
    return (
      (role === "system" || role === "user" || role === "assistant" || role === "tool") &&
      typeof content === "string"
    );
  });
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, string>();
  for (const entry of value) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id) continue;
    const normalized = id.toLowerCase();
    if (!map.has(normalized)) map.set(normalized, id);
  }
  return Array.from(map.values());
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed", requestId }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));

    const auth = await requireUser(req, body);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || auth.authError || !auth.userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Bearer token required", requestId }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = auth.supabaseAdmin;

    const temperature =
      typeof body.temperature === "number" ? body.temperature : 0.5;
    const jsonMode = body.jsonMode === true || body.response_format === "json";
    const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : undefined;

    let messages: ChatMessage[] | null = null;
    if (isChatMessageArray(body.messages)) {
      messages = body.messages;
    } else if (typeof body.userPrompt === "string") {
      const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : "";
      messages = [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        { role: "user" as const, content: body.userPrompt },
      ];
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing messages", requestId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const policy = await getServicePolicy(supabaseAdmin, auth.userId);
    const resolvedTier: "free" | "pro" = policy.tier === "pro" ? "pro" : "free";
    const routeConfig = await getAURequestConfig(supabaseAdmin, [], "chat", resolvedTier);
    const allowedModels = normalizeModelList(policy.allowed_models);

    if (!usageTrackingHandledByProxy(req)) {
      await consumeUsageOrThrow(supabaseAdmin, auth.userId, 'au_chat', { countInc: 1 });
    }

    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
    let model = routeConfig.modelId;
    if (requestedModel) {
      if (allowedModels.length === 0 || allowedModels.includes(requestedModel)) {
        model = requestedModel;
      } else {
        console.warn(`[model-call] Requested model ${requestedModel} not allowed by policy. Using routed model ${model}.`);
      }
    }

    const fallbackList = normalizeModelList([
      model,
      routeConfig.modelId,
      ...allowedModels,
    ]);

    const { content, usage } = await openrouterChatCompletions({
      supabaseAdmin,
      model,
      models: fallbackList,
      apiKey: routeConfig.apiKey,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: jsonMode ? { type: "json_object" } : undefined,
      requestId,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        content,
        model,
        usage,
        requestId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    if (error?.name === "LimitExceededError") {
      return new Response(
        JSON.stringify(error.context),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 402 },
      );
    }
    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
        requestId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: error.status || 500,
      },
    );
  }
});
