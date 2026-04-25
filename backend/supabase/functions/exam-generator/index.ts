// @ts-ignore: Deno modules
import { corsHeaders } from "../_shared/cors.ts";
import { consumeUsageOrThrow, LimitExceededError, ProRequiredError, requireProEntitlementOrThrow } from "../_shared/usage-guard.ts";
import { usageTrackingHandledByProxy } from "../_shared/usage-tracking.ts";

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
    const auth = await requireUser(req, body);
    const { userId, ownershipFilter, supabaseAdmin } = auth;
    const authError = auth.authError;

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

    // NEW: Usage Guard
    if (userId) {
        await requireProEntitlementOrThrow(supabaseAdmin, userId, 'practice_exam_generation');
        if (!usageTrackingHandledByProxy(req)) {
          await consumeUsageOrThrow(supabaseAdmin, userId, 'practice_exams');
        }
    } else {
        // Guests are not allowed
         return new Response(JSON.stringify({ 
            error: "Authentication required",
            details: "Please sign in to generate exams.",
            requestId
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Since RLS is disabled, we'll allow proceeding even if userId is missing,
    // but we prefer to have it for usage tracking.
    const effectiveFilter = ownershipFilter || {};

    const systemPrompt = `You are AU, an expert examiner developed solely by Fabian. Create a practice exam based on the provided study material.
    
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

    const modelOverride =
      (typeof body?.model === "string" && body.model.trim().length > 0 ? body.model.trim() : "") ||
      (req.headers.get("x-au-model") || "").trim() ||
      undefined;
    const routedApiKey = (req.headers.get("x-au-openrouter-key") || "").trim() || undefined;

    const aiResponse = await callAU(supabaseAdmin, systemPrompt, userPrompt, 0.5, false, modelOverride, {
      userId: userId ?? undefined,
      ownershipFilter: ownershipFilter,
      feature: "exam-generator",
      routedApiKey,
    }, "exam");

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

    const result = extractJson(aiResponse);

    if (!result) {
      return new Response(JSON.stringify({ 
        error: "Exam generation service temporarily unavailable. Please try again later.",
        requestId,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 502,
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

    if (error?.name === "ProRequiredError") {
        return new Response(JSON.stringify(error.context), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    if (error?.name === "LimitExceededError") {
        return new Response(JSON.stringify(error.context), {
            status: 402, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    const status = typeof error?.status === "number" ? error.status : 500;
    const safeMessage =
      status === 401 || status === 403
        ? "Unauthorized"
        : "Exam generator temporarily unavailable. Please try again later.";
    return new Response(JSON.stringify({ 
      error: safeMessage,
      details: error.details || error.message || String(error),
      isThrottled: error.isThrottled || false,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });
  }
});
