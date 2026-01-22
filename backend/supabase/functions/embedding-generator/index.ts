// @ts-ignore: Deno modules
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, validateAuth, requireAnyAuth, emitEvent } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";

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
    const { documentId } = body;
    const { userId, ownershipFilter, supabaseAdmin, error: authError } = await requireAnyAuth(req, body);

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

    if (!documentId) {
      return new Response(JSON.stringify({ 
        error: "Missing required field: documentId",
        details: "A documentId must be provided",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Even if RLS is disabled, we prefer to have an owner for tracking.
    const effectiveFilter = ownershipFilter || {};

    // 1. Fetch Chunks with manual ownership enforcement
    const query = supabaseAdmin
      .from("au_document_chunks")
      .select("*")
      .eq("document_id", documentId);
    
    if (Object.keys(effectiveFilter).length > 0) {
      query.match(effectiveFilter);
    }

    const { data: chunks, error: chunksError } = await query;

    if (chunksError) {
      return new Response(JSON.stringify({ 
        error: "Fetch failed",
        details: chunksError.message,
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    if (!chunks || chunks.length === 0) {
      return new Response(JSON.stringify({ 
        error: "No chunks",
        details: "No chunks found for this document",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    // 2. Get OpenAI Key (for Embeddings)
    const openAiKey = await getApiKey(supabaseAdmin, "openai");

    const embeddingsData: any[] = [];

    // 3. Generate Embeddings (Batching to reduce round trips)
    // Note: A real production system would use a queue.
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const inputs = batch.map((c: any) => c.text.replace(/\n/g, ' '));

      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          input: inputs,
          model: "text-embedding-ada-002",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(JSON.stringify({ 
          error: "Embedding API Error",
          details: errorText,
          requestId 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }

      const data = await response.json();
      
      data.data.forEach((item: any, idx: number) => {
        embeddingsData.push({
          chunk_id: batch[idx].id,
          embedding: item.embedding,
          model_name: "text-embedding-ada-002"
        });
      });
    }

    // 4. Store Embeddings
    const { error: insertError } = await supabaseAdmin
      .from("au_document_embeddings")
      .insert(embeddingsData);

    if (insertError) {
      return new Response(JSON.stringify({ 
        error: "Store failed",
        details: insertError.message,
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // 5. Update Document Status
    const updateDocQuery = supabaseAdmin
      .from("au_documents")
      .update({ status: "completed" })
      .eq("id", documentId);
    
    if (Object.keys(effectiveFilter).length > 0) {
      updateDocQuery.match(effectiveFilter);
    }

    await updateDocQuery;

    // 6. Emit Sync Event
    await emitEvent(supabaseAdmin, {
      event_type: 'embedding_created',
      entity_id: documentId,
      user_id: userId || 'anonymous',
      metadata: { chunkCount: embeddingsData.length }
    });

    return new Response(JSON.stringify({ 
      ok: true,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[embedding-generator] Error [${requestId}]:`, error);
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
