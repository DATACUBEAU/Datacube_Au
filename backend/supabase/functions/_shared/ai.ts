import { createClient } from "@supabase/supabase-js";
import { getApiKey } from "./getApiKey.ts";

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
  const openRouterKey = await getApiKey(supabaseAdmin, "openrouter");
  
  // 1. Check for Model Override or Default from DB
  let model = modelOverride;

  if (!model) {
      // Try to fetch default from DB, otherwise fallback to hardcoded approved model
      const { data: setting } = await supabaseAdmin
          .from('au_rag_settings')
          .select('value')
          .eq('key', 'default_model')
          .single();
      
      if (setting && setting.value) {
          model = typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value).replace(/"/g, '');
      } else {
          // Fallback to one of the approved free models
          model = "allenai/olmo-3.1-32b-think:free"; 
      }
  }

  // Ensure model is one of the approved ones (optional strict check, but we allow admin override)
  // Approved: 
  // - allenai/olmo-3.1-32b-think:free
  // - nvidia/nemotron-3-nano-30b-a3b:free
  // - mistralai/devstral-2512:free
  // - google/gemini-2.0-flash-exp:free (Previous default, keeping as fallback option if configured)

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
      "HTTP-Referer": "https://datacube-au.vercel.app",
      "X-Title": "DataCube AU",
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: temperature,
      response_format: jsonMode ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const usage = (data as any)?.usage;
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
  return data.choices[0].message.content;
}
