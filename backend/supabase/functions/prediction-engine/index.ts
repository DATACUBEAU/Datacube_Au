// @ts-ignore: Deno modules
import { corsHeaders } from "../_shared/cors.ts";

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
    const { callAU, requireUser, emitEvent } = await import("../_shared/au.ts");

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

    // Use centralized callAU with automatic retries and model selection
    const aiResponse = await callAU(supabaseAdmin, systemPrompt, userPrompt, 0.4, false, undefined, {
      userId: userId || undefined,
      ownershipFilter: ownershipFilter,
      feature: "prediction-engine",
    }, "prediction");

    const parsed = extractJson(aiResponse);
    if (!parsed) {
      return new Response(JSON.stringify({
        error: "Invalid AU response format",
        details: "Failed to parse AU output as JSON",
        requestId,
        rawResponse: aiResponse,
      }), {
        headers: corsHeadersWithJson,
        status: 500,
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
    
    // Use the error's own message if it's already a clean "All models unavailable" message
    const rawMessage = error.message || String(error);
    const safeMessage =
      status === 401 || status === 403
        ? "Unauthorized"
        : (rawMessage.includes("All AI models") ? rawMessage : "Exam prediction service temporarily unavailable. Please try again later.");
        
    return new Response(JSON.stringify({ 
      error: safeMessage,
      details: error.details || error.message || String(error),
      requestId
    }), {
      headers: corsHeadersWithJson,
      status,
    });
  }
});
