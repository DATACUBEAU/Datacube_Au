// @ts-ignore: Deno modules
import { corsHeaders, callAU, requireAdmin } from "../_shared/au.ts";

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
    const { userId, ownershipFilter, supabaseAdmin } = await requireAdmin(req, body);

    const { systemPrompt, userPrompt, model, temperature } = body;

    if (!userPrompt) {
      return new Response(JSON.stringify({ 
        error: "Missing userPrompt",
        details: "A userPrompt must be provided",
        requestId
      }), {
        headers: corsHeadersWithJson,
        status: 400,
      });
    }

    // Call shared AU logic (which handles OpenRouter key injection)
    const response = await callAU(
      supabaseAdmin,
      systemPrompt,
      userPrompt,
      typeof temperature === "number" ? temperature : 0.5,
      false,
      typeof model === "string" ? model : undefined,
      { userId: userId || undefined, ownershipFilter, feature: "openrouter-proxy" }
    ); 

    return new Response(JSON.stringify({ 
      ok: true,
      response,
      requestId
    }), {
      headers: corsHeadersWithJson,
    });

  } catch (error: any) {
    console.error(`[openrouter-proxy] Error [${requestId}]:`, error);
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
