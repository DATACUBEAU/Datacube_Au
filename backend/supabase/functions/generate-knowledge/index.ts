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
    const { callAU, validateAuth, requireUser } = await import("../_shared/au.ts");

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

    const { documentContent, pastQuestionsContent } = body;

    if (!documentContent && !pastQuestionsContent) {
      return new Response(JSON.stringify({ 
        error: "Missing content",
        details: "Document content or past questions content is required",
        requestId
      }), {
        headers: corsHeadersWithJson,
        status: 400,
      });
    }

    const systemPrompt = `You are an expert educational content creator. Your goal is to analyze the provided text and generate high-quality study materials.
    
    If past exam questions are provided, use them to highlight which areas are most likely to be tested in the summary and study roadmap.
    
    You must output a valid JSON object with the following structure:
    {
      "summary": "A concise summary of the document (approx 100-150 words).",
      "keyPoints": "A numbered list of the top 5-7 most important points. Format as a string with newlines.",
      "conceptMap": "A descriptive paragraph explaining core concepts and their definitions. Format: 'Concept' (Definition).",
      "topicRelationships": "A paragraph explaining how the different topics in the document relate to each other.",
      "studyRoadmap": "A numbered list recommending a step-by-step study path. Format as a string with newlines."
    }
    
    Ensure the content is accurate, educational, and directly derived from the source text.`;

    let userPrompt = "";
    if (documentContent) {
      userPrompt += `Study Material:\n\n${documentContent.substring(0, 15000)}\n\n`;
    }
    if (pastQuestionsContent) {
      userPrompt += `Reference Past Exam Questions:\n\n${pastQuestionsContent.substring(0, 10000)}`;
    }

    const aiResponse = await callAU(supabaseAdmin, systemPrompt, userPrompt, 0.5, true, undefined, {
      userId: userId || undefined,
      ownershipFilter: ownershipFilter,
      feature: "generate-knowledge",
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

    return new Response(JSON.stringify({
      ok: true,
      ...result,
      requestId
    }), {
      headers: corsHeadersWithJson,
    });

  } catch (error: any) {
    console.error(`[generate-knowledge] Error [${requestId}]:`, error);
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
