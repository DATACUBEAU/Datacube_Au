/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders, requireAnyAuth } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);
  const corsHeadersWithJson = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { userId, ownershipFilter, supabaseAdmin, error: authError } = await requireAnyAuth(req, body);

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

    const effectiveFilter = (ownershipFilter || {}) as any;
    const { query, threshold = 0.5, limit = 5, probes = 10 } = body;

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

    // Generate Query Embedding
    const openAiKey = await getApiKey(supabaseAdmin, "openai");
    
    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        input: query,
        model: "text-embedding-ada-002",
      }),
    });

    if (!embeddingResponse.ok) {
      const errText = await embeddingResponse.text();
      return new Response(JSON.stringify({ 
        error: "Embedding failed",
        details: `${embeddingResponse.status} ${errText}`,
        requestId
      }), {
        headers: corsHeadersWithJson,
        status: 500,
      });
    }
    
    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Call RPC with manual ownership filters and tuning
    const { data: chunks, error: rpcError } = await supabaseAdmin.rpc("au_vector_search", {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
      p_user_id: effectiveFilter.user_id || null,
      p_guest_session_id: effectiveFilter.guest_session_id || null,
      p_probes: probes
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

    return new Response(JSON.stringify({ 
      ok: true,
      chunks,
      requestId
    }), {
      headers: corsHeadersWithJson,
    });

  } catch (error: any) {
    console.error(`[vector-search] Error [${requestId}]:`, error);
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
