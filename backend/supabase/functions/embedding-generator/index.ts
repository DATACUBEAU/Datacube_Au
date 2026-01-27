import { corsHeaders, emitEvent, requireAnyAuth } from "../_shared/au.ts";
import { openrouterEmbeddings } from "../_shared/openrouter.ts";

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

    const embeddingsData: any[] = [];

    let embeddingModel: string | null = null;
    try {
      const { data: setting } = await supabaseAdmin
        .from("au_rag_settings")
        .select("value")
        .eq("key", "embedding_model")
        .single();

      if (setting?.value) {
        embeddingModel = typeof setting.value === "string"
          ? setting.value
          : JSON.stringify(setting.value).replace(/"/g, "");
      }
    } catch {
      embeddingModel = null;
    }

    embeddingModel = embeddingModel || "openai/text-embedding-ada-002";

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const inputs = batch.map((c: any) => String(c.text || "").replace(/\n/g, " "));

      const { embeddings } = await openrouterEmbeddings({
        supabaseAdmin,
        model: embeddingModel,
        input: inputs,
        requestId,
      });

      if (embeddings.length !== batch.length) {
        return new Response(
          JSON.stringify({
            error: "Embedding API Error",
            details: "Embedding count mismatch",
            requestId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
        );
      }

      embeddings.forEach((embedding: number[], idx: number) => {
        embeddingsData.push({
          chunk_id: batch[idx].id,
          embedding,
          model_name: embeddingModel,
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
