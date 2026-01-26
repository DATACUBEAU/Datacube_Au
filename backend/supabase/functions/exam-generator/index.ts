// @ts-ignore: Deno modules
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const { callAU, validateAuth, requireUser, emitEvent } = await import("../_shared/au.ts");

    const body = await req.json().catch(() => ({}));
    const { userId, isGuest, ownershipFilter, supabaseAdmin, error: authError } = await requireUser(req, body);

    if (authError) {
      return new Response(JSON.stringify({ 
        error: authError,
        details: "Authentication failed",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { documentContent, pastQuestionsContent, documentId } = body;

    if (!documentContent && !pastQuestionsContent) {
      return new Response(JSON.stringify({ 
        error: "Missing content",
        details: "Document content or past questions content is required",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Since RLS is disabled, we'll allow proceeding even if userId is missing,
    // but we prefer to have it for usage tracking.
    const effectiveFilter = ownershipFilter || {};

    const systemPrompt = `You are an expert examiner. Create a practice exam based on the provided study material.
    
    If past exam questions are provided, use them to influence the style and difficulty of the questions, but ensure the content is primarily based on the study material.
    
    You must output a valid JSON object with the following structure:
    {
      "questions": [
        {
          "questionText": "The multiple choice question text",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "The correct option text (must match one of the options exactly)",
          "explanation": "Detailed explanation of why this is the correct answer."
        }
      ]
    }
    
    Generate 5-10 high-quality questions that test understanding, not just recall.`;

    let userPrompt = "";
    if (documentContent) {
      userPrompt += `Study Material:\n\n${documentContent.substring(0, 12000)}\n\n`;
    }
    if (pastQuestionsContent) {
      userPrompt += `Reference Past Exam Questions:\n\n${pastQuestionsContent.substring(0, 8000)}`;
    }

    const aiResponse = await callAU(supabaseAdmin, systemPrompt, userPrompt, 0.5, true, undefined, {
      userId: userId ?? undefined,
      ownershipFilter: ownershipFilter,
      feature: "exam-generator",
    });

    let result;
    try {
      result = JSON.parse(aiResponse);
    } catch (e) {
      return new Response(JSON.stringify({ 
        error: "Parse failed",
        details: "AI returned invalid JSON",
        requestId,
        raw: aiResponse
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Emit Sync Event
    if (userId) {
      await emitEvent(supabaseAdmin, {
        event_type: 'exam_generated',
        entity_id: 'new_exam',
        user_id: userId,
        metadata: { questionCount: result.questions?.length }
      });

      // Persist to au_exams
      const { error: saveError } = await supabaseAdmin
        .from('au_exams')
        .insert({
          user_id: isGuest ? null : userId,
          guest_session_id: isGuest ? userId : null,
          document_id: documentId || null,
          content: result
        });
      
      if (saveError) {
        console.error(`[exam-generator] Failed to save exam:`, saveError);
      }
    }

    return new Response(JSON.stringify({ 
      ok: true,
      ...result,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[exam-generator] Error [${requestId}]:`, error);
    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error",
      details: error.stack || String(error),
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error.status || 500,
    });
  }
});
