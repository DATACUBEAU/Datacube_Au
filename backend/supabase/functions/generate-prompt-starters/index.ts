// @ts-ignore: Deno modules
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, callAU, validateAuth, requireUser, requireAnyAuth } from "../_shared/au.ts";
import { consumeUsageOrThrow, LimitExceededError } from "../_shared/usage-guard.ts";
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

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized", requestId }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!usageTrackingHandledByProxy(req)) {
      await consumeUsageOrThrow(supabaseAdmin, userId, 'au_chat');
    }

    const { documentTitle, documentContent, userIdea } = body;

    if (!documentContent) {
      return new Response(JSON.stringify({ 
        error: "Missing document content",
        details: "Document content is required to generate prompts",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const systemPrompt = `You are AU, an intelligent Exam Coach and Tutor developed solely by Fabian.
    Your goal is to suggest 4 smart, high-value study questions for the provided document.
    
    Avoid generic questions like "What is this about?".
    Instead, focus on:
    1. Key definitions and concepts.
    2. Exam-style questions (e.g., "Compare X and Y").
    3. Critical analysis or application.
    
    You must output a valid JSON object with the following structure:
    {
      "prompts": [
        "Question 1?",
        "Question 2?",
        "Question 3?",
        "Question 4?"
      ]
    }`;

    let userPrompt = `Generate chat prompt starters for a document titled "${documentTitle}".\n\nContent Preview:\n${documentContent.substring(0, 5000)}`;
    
    if (userIdea) {
      userPrompt += `\n\nThe user is specifically interested in: ${userIdea}`;
    }

    const aiResponse = await callAU(supabaseAdmin, systemPrompt, userPrompt, 0.7, true, undefined, {
      userId: userId as string,
      ownershipFilter: ownershipFilter,
      feature: "generate-prompt-starters",
    }, "chat");

    let result;
    try {
      result = JSON.parse(aiResponse);
    } catch (e) {
      return new Response(JSON.stringify({ 
        error: "Parse failed",
        details: "AU returned invalid JSON",
        requestId,
        raw: aiResponse
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
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
    console.error(`[generate-prompt-starters] Error [${requestId}]:`, error);

    if (error?.name === "LimitExceededError") {
      return new Response(JSON.stringify(error.context), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error",
      details: error.stack || String(error),
      isThrottled: error.isThrottled || false,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error.status || 500,
    });
  }
});
