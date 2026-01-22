/// <reference path="../deno.d.ts" />
// @ts-ignore - Deno Edge Function (HTTP imports are valid in Deno runtime)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { requireAnyAuth } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";

// Inlined CORS headers for robustness
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
};

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
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

    let openaiKey;
    try {
      openaiKey = await getApiKey(supabase, "openai");
    } catch (e) {
      openaiKey = await getApiKey(supabase, "openrouter");
    }

    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
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
    const embedding = embeddingData.data[0].embedding;

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
