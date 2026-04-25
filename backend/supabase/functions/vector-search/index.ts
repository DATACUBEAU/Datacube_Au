/// <reference path="../deno.d.ts" />
import { generateEmbedding, getCorsHeaders, requireUser } from "../_shared/au.ts";
import { searchQdrant } from "../_shared/qdrant.ts";
import { consumeUsageOrThrow, LimitExceededError } from "../_shared/usage-guard.ts";
import { usageTrackingHandledByProxy } from "../_shared/usage-tracking.ts";

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
    const { userId, supabaseAdmin } = await requireUser(req, body);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized", details: "Authentication failed", requestId }), { headers: corsHeadersWithJson, status: 401 });
    }

    if (!usageTrackingHandledByProxy(req)) {
      await consumeUsageOrThrow(supabaseAdmin, userId, 'au_chat', { countInc: 1 });
    }

    const { query, threshold = 0.5, limit = 5 } = body;

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

    // 1. Generate query embedding
    const queryEmbedding = await generateEmbedding(supabaseAdmin, query);

    // 2. Build Qdrant filter for multi-tenancy (Brain's RLS logic applied to Vector Engine)
    const qdrantFilter: any = {
      must: []
    };
    qdrantFilter.must.push({ key: "user_id", match: { value: userId } });

    // 3. Search Qdrant
    console.log(`[vector-search] Searching Qdrant for request ${requestId}...`);
    const qdrantResults = await searchQdrant(queryEmbedding, {
      limit,
      score_threshold: threshold,
      filter: qdrantFilter
    });

    // 4. Map results to consistent format
    const chunks = qdrantResults.map(res => ({
      id: res.id,
      text: res.payload.text,
      document_id: res.payload.document_id,
      similarity: res.score,
      metadata: {
        chunk_index: res.payload.chunk_index,
        created_at: res.payload.created_at
      }
    }));

    return new Response(JSON.stringify({ 
      ok: true,
      chunks,
      requestId
    }), {
      headers: corsHeadersWithJson,
    });

  } catch (error: any) {
    console.error(`[vector-search] Error [${requestId}]:`, error);

    if (error?.name === "LimitExceededError") {
      return new Response(JSON.stringify(error.context), { status: 402, headers: corsHeadersWithJson });
    }

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
