// @ts-ignore: Deno modules
import { corsHeaders } from "../_shared/cors.ts";

const PREDICTION_ENGINE_CANDIDATE_MODELS = [
  "mistralai/mistral-7b-instruct",
  "mistralai/mistral-7b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct",
  "meta-llama/llama-3-8b-instruct",
  "google/gemma-7b-it",
  "google/gemma-2b-it",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-r1",
  "qwen/qwen-2-7b-instruct",
  "qwen/qwen-1.5-7b-chat",
  "nousresearch/nous-hermes-2-mistral-7b",
  "openchat/openchat-7b",
  "teknium/openhermes-2.5-mistral-7b",
  "phind/phind-codellama-34b",
  "gryphe/mythomist-7b",
  "undi95/toppy-m-7b",
  "intel/neural-chat-7b",
  "microsoft/phi-3-medium-128k-instruct",
  "microsoft/phi-3-mini-128k-instruct",
  "huggingfaceh4/zephyr-7b-beta",
] as const;

const modelCooldownUntilMs = new Map<string, number>();

function isModelOnCooldown(modelId: string) {
  const until = modelCooldownUntilMs.get(modelId);
  return typeof until === "number" && until > Date.now();
}

function setModelCooldown(modelId: string, cooldownMs: number) {
  modelCooldownUntilMs.set(modelId, Date.now() + cooldownMs);
}

function parseOpenRouterStatus(err: any): number | null {
  const msg = typeof err?.message === "string" ? err.message : "";
  const m = msg.match(/OpenRouter (?:API|Embedding) Error:\s*(\d{3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sanitizeProviderMessage(err: any): string {
  const msg = typeof err?.message === "string" ? err.message : "";
  if (!msg) return "Unknown error";
  const parts = msg.split(" - ");
  return parts[0] || "Unknown error";
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeadersWithJson = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const { requireUser, emitEvent } = await import("../_shared/au.ts");
    const { openrouterChatCompletions } = await import("../_shared/openrouter.ts");

    const body = await req.json().catch(() => ({}));
    const { userId, ownershipFilter, supabaseAdmin } = await requireUser(req, body);

    // Since RLS is disabled, we'll allow proceeding even if userId is missing,
    // but we prefer to have it for usage tracking.
    const effectiveFilter = ownershipFilter || {};

    const { pastQuestionsContent, mainTextbookContent } = body;

    if (!pastQuestionsContent) {
      return new Response(JSON.stringify({ 
        error: "Missing content",
        details: "Past questions content is required",
        requestId
      }), {
        headers: corsHeadersWithJson,
        status: 400,
      });
    }

    const systemPrompt = `You are AU, an expert exam strategist and predictor. You were developed solely by Fabian as a solo development project.
    Analyze the provided past exam questions (and optional textbook content) to predict upcoming exam topics.

    You must output a valid JSON object with the following structure:
    {
      "briefing": "A bold, encouraging executive summary of the analysis in markdown format. Use emojis and be direct. e.g., '# 🚀 Exam Intelligence Briefing\n\nBased on the past 3 years...'",
      "topicWeights": "A numbered list of the top 5 most important topics and their percentage weight. Format: '1. Topic Name: XX%'",
      "predictions": [
        {
          "topic": "Name of the predicted topic",
          "likelihood": 85,
          "rationale": "Explanation of why this is likely (e.g., appeared in 3 of last 4 years).",
          "commonMistake": "A common error students make on this topic.",
          "examTip": "A specific tip for answering questions on this topic."
        }
      ]
    }
    
    Provide 3-5 detailed predictions. Be specific and data-driven based on the input text.`;

    let userPrompt = `Analyze these past exam questions:\n\n${pastQuestionsContent.substring(0, 15000)}`;
    if (mainTextbookContent) {
      userPrompt += `\n\nReference context from the main textbook:\n\n${mainTextbookContent.substring(0, 10000)}`;
    }

    const extractJson = (text: string) => {
      const trimmed = (text || "").trim();
      const withoutFences = trimmed
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      const start = withoutFences.indexOf("{");
      const end = withoutFences.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const slice = withoutFences.slice(start, end + 1);
        try {
          return JSON.parse(slice);
        } catch {
        }
      }

      return null;
    };

    let aiResponse: string | null = null;
    let parsed: any | null = null;

    for (const modelId of PREDICTION_ENGINE_CANDIDATE_MODELS) {
      if (isModelOnCooldown(modelId)) continue;

      try {
        const res = await openrouterChatCompletions({
          supabaseAdmin,
          model: modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.4,
          requestId,
        });

        aiResponse = res.content;
        parsed = extractJson(aiResponse);
        if (!parsed) {
          throw new Error("Prediction Engine model returned non-JSON output");
        }

        break;
      } catch (err: any) {
        const status = parseOpenRouterStatus(err);

        if (status === 404) setModelCooldown(modelId, 24 * 60 * 60 * 1000);
        else if (status === 429) setModelCooldown(modelId, 60 * 1000);
        else if (typeof status === "number" && status >= 500) setModelCooldown(modelId, 2 * 60 * 1000);
        else setModelCooldown(modelId, 2 * 60 * 1000);

        console.warn(
          `[prediction-engine] model_failed requestId=${requestId} model=${modelId} status=${status ?? "unknown"} reason=${sanitizeProviderMessage(err)}`,
        );
      }
    }
    
    if (!parsed) {
      const safeMessage = "Exam prediction service temporarily unavailable. Please try again later.";
      return new Response(JSON.stringify({
        error: safeMessage,
        requestId,
      }), {
        headers: corsHeadersWithJson,
        status: 503,
      });
    }

    const result = parsed as any;

    // Emit Sync Event
    if (userId) {
      await emitEvent(supabaseAdmin, {
        event_type: 'prediction_generated',
        entity_id: 'new_prediction',
        user_id: userId,
        metadata: { predictionCount: result.predictions?.length }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      ...result,
      requestId
    }), {
      headers: corsHeadersWithJson,
    });

  } catch (error: any) {
    console.error(`[prediction-engine] Error [${requestId}]:`, error);
    const status = typeof error?.status === "number" ? error.status : 500;
    const safeMessage =
      status === 401 || status === 403
        ? "Unauthorized"
        : "Exam prediction service temporarily unavailable. Please try again later.";
    return new Response(JSON.stringify({ 
      error: safeMessage,
      requestId
    }), {
      headers: corsHeadersWithJson,
      status,
    });
  }
});
