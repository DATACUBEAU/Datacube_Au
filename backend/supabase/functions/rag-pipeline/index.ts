/// <reference path="../deno.d.ts" />
import { generateEmbedding, getCorsHeaders, requireAnyAuth } from "../_shared/au.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);
  const corsHeadersWithJson = { ...corsHeaders, "Content-Type": "application/json" };

  // 1. Handle CORS preflight IMMEDIATELY
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { ownershipFilter, supabaseAdmin: supabase, error: authError } = await requireAnyAuth(req, body);

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

    const { query } = body;
    if (!query) {
      return new Response(JSON.stringify({ 
        error: "Missing query",
        details: "A query must be provided",
        requestId
      }), {
        headers: corsHeadersWithJson,
        status: 400,
      });
    }

    const embedding = await generateEmbedding(supabase, query);

    // Use supabaseAdmin and explicit ownership filters
    const filter = (ownershipFilter || {}) as any;
    const { data: chunks, error: rpcError } = await supabase.rpc("au_vector_search", {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: 5,
      p_user_id: filter.user_id || null,
      p_guest_session_id: filter.guest_session_id || null
    });

    if (rpcError) {
      return new Response(JSON.stringify({ 
        error: "Database search failed",
        details: rpcError.message,
        requestId
      }), {
        headers: corsHeadersWithJson,
        status: 500,
      });
    }

    const context = chunks?.map((c: any) => c.text).join("\n\n") || "";
    
    return new Response(JSON.stringify({ 
      ok: true,
      context, 
      chunks,
      augmentedPrompt: `Use the following context...\n${context}`,
      requestId
    }), {
      headers: corsHeadersWithJson,
    });

  } catch (error: any) {
    console.error(`[rag-pipeline] Error [${requestId}]:`, error);
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
