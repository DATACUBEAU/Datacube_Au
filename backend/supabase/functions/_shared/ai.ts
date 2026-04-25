import { openrouterChatCompletions } from "./openrouter.ts";
import { getAURequestConfig, getVerifiedModelIds, reportModelHealth, reportKeyHealth } from "./model_registry.ts";
import { getServicePolicy } from "./gating.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
};

export interface AUResponse {
  text: string;
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, string>();
  for (const row of value) {
    const model = typeof row === "string" ? row.trim() : "";
    if (!model) continue;
    const normalized = model.toLowerCase();
    if (!map.has(normalized)) map.set(normalized, model);
  }
  return Array.from(map.values());
}

export async function callAU(
  supabaseAdmin: any,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: { userId?: string; feature?: string; sessionId?: string },
  scope = "chat"
): Promise<string> {
  let allowedModels: string[] = [];
  let resolvedTier: "free" | "pro" = "free";
  if (usageContext?.userId) {
    const policy = await getServicePolicy(supabaseAdmin, usageContext.userId);
    resolvedTier = policy.tier === "pro" ? "pro" : "free";
    allowedModels = normalizeModelList(policy.allowed_models);
  } else {
    allowedModels = normalizeModelList(getVerifiedModelIds());
  }

  const config = await getAURequestConfig(supabaseAdmin, [], scope, resolvedTier);
  let currentApiKey: string | undefined = config.apiKey;

  if (allowedModels.length === 0 && config.modelId) {
    allowedModels = [config.modelId];
  }

  let currentModel = (typeof modelOverride === "string" ? modelOverride.trim() : "") || config.modelId;
  if (!currentModel && allowedModels.length > 0) {
    currentModel = allowedModels[0];
  }
  if (!currentModel) {
    throw new Error("No active model configured for AI call.");
  }

  const attemptedModels: string[] = [];
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[ai][${scope}] Attempt ${attempt + 1}/${MAX_RETRIES + 1} using model: ${currentModel}`);
      
      const { content, usage } = await openrouterChatCompletions({
        supabaseAdmin,
        model: currentModel,
        models: normalizeModelList([currentModel, ...allowedModels]),
        apiKey: currentApiKey,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        response_format: jsonMode ? { type: "json_object" } : undefined,
      });

      // Report success for health scoring
      reportModelHealth(currentModel, true, undefined, scope);

      // Success! Log usage and return.
      const userId = usageContext?.userId;
      const feature = usageContext?.feature;
      if (userId && feature && usage) {
        await supabaseAdmin.from('au_model_usage').insert([
          {
            user_id: userId,
            feature,
            model_id: currentModel,
            prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
            completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
            total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
            cost: typeof usage.total_cost === 'number' ? usage.total_cost : null,
            metadata: { 
              sessionId: usageContext?.sessionId ?? null, 
              usage,
              fallbackChain: attemptedModels 
            },
          },
        ]);
      }

      return content;

    } catch (error: any) {
      const message = error.message || String(error);
      console.warn(`[ai][${scope}] Model ${currentModel} failed: ${message}`);
      
      // If it's a terminal configuration error (e.g. missing API key), don't retry other models
      if (message.includes("API key for") && message.includes("not found")) {
        console.error(`[ai] Terminal configuration error: ${message}`);
        throw error;
      }

      // Mark as failed in registry (health update)
      reportModelHealth(currentModel, false, typeof error?.status === "number" ? error.status : undefined, scope);
      if (currentApiKey) {
        await reportKeyHealth(supabaseAdmin, currentApiKey, false, typeof error?.status === "number" ? error.status : undefined);
      }
      
      // If we hit a rate limit (429), add a small delay before the next attempt
      if (error?.status === 429) {
        const delay = 500 + Math.random() * 500; // 500-1000ms jitter
        console.log(`[ai.ts] Rate limit hit on ${currentModel}. Waiting ${Math.round(delay)}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      attemptedModels.push(currentModel);

      // If we've exhausted retries, throw a clean error
      if (attempt === MAX_RETRIES) {
        console.warn(`[ai] Exhausted model attempts. Chain: ${attemptedModels.join(" -> ")}.`);
        const lastErrorMessage = error?.message || "Exhausted all models";
        
        // Check for specific OpenRouter errors to give better feedback
        let userMessage = `All AI models are currently unavailable. Last error: ${lastErrorMessage}`;
        if (lastErrorMessage.includes("400")) {
             userMessage = "The AI provider rejected the request format (400). This might be due to model deprecation or parameter mismatch.";
        } else if (lastErrorMessage.includes("401")) {
             userMessage = "AI service authentication failed (401). Please check backend API keys.";
        }

        const finalError = new Error(userMessage) as any;
        finalError.status = 503;
        finalError.details = lastErrorMessage;
        throw finalError;
      }

      // Prepare next model
      // We exclude everything we've already tried in this request
      const config = await getAURequestConfig(supabaseAdmin, attemptedModels, scope, resolvedTier);
      currentModel = config.modelId;
      currentApiKey = config.apiKey;
    }
  }


  throw new Error("Unexpected end of retry loop");
}
