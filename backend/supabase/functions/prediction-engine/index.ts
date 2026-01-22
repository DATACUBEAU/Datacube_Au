// @ts-ignore: Deno modules
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, callAU, validateAuth, requireUser, emitEvent } from "../_shared/au.ts";

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
    const body = await req.json().catch(() => ({}));
    const { userId, ownershipFilter, supabaseAdmin, error: authError } = await requireUser(req, body);

    if (authError) {
      return new Response(JSON.stringify({ 
        error: authError,
        details: "Authentication failed",
        requestId
      }), {
        headers: corsHeadersWithJson,
        status: 401,
      });
    }

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

    const systemPrompt = `You are an expert exam strategist and predictor. Analyze the provided past exam questions (and optional textbook content) to predict upcoming exam topics.

    You must output a valid JSON object with the following structure:
    {
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

    const aiResponse = await callAU(supabaseAdmin, systemPrompt, userPrompt, 0.4, true, undefined, {
      userId: userId ?? undefined,
      ownershipFilter: ownershipFilter,
      feature: "prediction-engine",
    });
    
    let result;
    try {
      result = JSON.parse(aiResponse);
    } catch (e) {
      return new Response(JSON.stringify({ 
        error: "Invalid AI response format",
        details: "Failed to parse AI output as JSON",
        requestId,
        rawResponse: aiResponse
      }), {
        headers: corsHeadersWithJson,
        status: 500,
      });
    }

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
    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error",
      details: error.stack || String(error),
      requestId
    }), {
      headers: corsHeadersWithJson,
      status: error.status || 500,
    });
  }
});
