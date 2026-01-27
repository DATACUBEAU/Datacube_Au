import { openrouterChatCompletions } from "./openrouter.ts";

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
  let model = modelOverride;
  if (!model) {
    try {
      const { data: setting } = await supabaseAdmin
        .from('au_rag_settings')
        .select('value')
        .eq('key', 'default_model')
        .single();

      if (setting?.value) {
        model = typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value).replace(/"/g, '');
      }
    } catch {
    }
  }

  model = model || "allenai/olmo-3.1-32b-think:free";

  const { content, usage } = await openrouterChatCompletions({
    supabaseAdmin,
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    response_format: jsonMode ? { type: "json_object" } : undefined,
  });

  const userId = usageContext?.userId;
  const feature = usageContext?.feature;
  if (userId && feature && usage) {
    await supabaseAdmin.from('au_model_usage').insert([
      {
        user_id: userId,
        feature,
        model_id: model,
        prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
        completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
        total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        cost: typeof usage.total_cost === 'number' ? usage.total_cost : null,
        metadata: { sessionId: usageContext?.sessionId ?? null, usage },
      },
    ]);
  }

  return content;
}
