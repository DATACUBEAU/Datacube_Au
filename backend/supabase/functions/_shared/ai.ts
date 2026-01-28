import { openrouterChatCompletions } from "./openrouter.ts";
import { getNextAvailableModelAsync, getVerifiedModelIds, markModelAsFailed } from "./model_registry.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
};

export interface AUResponse {
  text: string;
}

export async function callAU(
  supabaseAdmin: any,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.5,
  jsonMode = false,
  modelOverride?: string,
  usageContext?: { userId?: string; feature?: string; sessionId?: string }
): Promise<string> {
  // 1. Determine Initial Model
  let currentModel = modelOverride;

  if (!currentModel) {
    // Try to get from DB settings first
    try {
      const { data: setting } = await supabaseAdmin
        .from('au_rag_settings')
        .select('value')
        .eq('key', 'default_model')
        .single();

      if (setting?.value) {
        currentModel = typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value).replace(/"/g, '');
      }
    } catch {
      // Ignore DB errors
    }
  }

  // If still no model (or DB failed), get best available from registry
  if (!currentModel) {
    currentModel = await getNextAvailableModelAsync(supabaseAdmin);
  }

  const attemptedModels: string[] = [];
  const MAX_RETRIES = Math.max(0, Math.min(getVerifiedModelIds().length, 20) - 1);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[ai] Attempt ${attempt + 1}/${MAX_RETRIES + 1} using model: ${currentModel}`);
      
      const { content, usage } = await openrouterChatCompletions({
        supabaseAdmin,
        model: currentModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        response_format: jsonMode ? { type: "json_object" } : undefined,
      });

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
      console.warn(`[ai] Model ${currentModel} failed: ${error.message}`);
      
      // Mark as failed in registry (cooldown)
      markModelAsFailed(currentModel, typeof error?.status === "number" ? error.status : undefined);
      attemptedModels.push(currentModel);

      // If we've exhausted retries, throw the last error
      if (attempt === MAX_RETRIES) {
        console.warn(`[ai] Exhausted model attempts. Chain: ${attemptedModels.join(" -> ")}.`);
        throw new Error("All AI models are currently unavailable.");
      }

      // Prepare next model
      // We exclude everything we've already tried in this request
      currentModel = await getNextAvailableModelAsync(supabaseAdmin, attemptedModels);
    }
  }

  throw new Error("Unexpected end of retry loop");
}
