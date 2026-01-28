// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders, callAU, validateAuth, generateEmbedding } from "../_shared/au.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);

  // 1. Handle OPTIONS -> return 204
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    
    // 2. Validate Auth (need userId and ownershipFilter)
    const { userId, ownershipFilter, supabaseAdmin, authError } = await validateAuth(req, body);

    if (authError || !userId || !ownershipFilter) {
      return new Response(JSON.stringify({ 
        error: authError || "Unauthorized",
        details: "Authentication failed",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { question } = body;
    if (!question) {
      return new Response(JSON.stringify({ 
        error: "Missing required field: question",
        details: "A question must be provided",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    
    // 2. Embed Question
    let embedding;
    try {
      embedding = await generateEmbedding(supabaseAdmin, question);
    } catch (embError: any) {
       return new Response(JSON.stringify({ 
          error: "Failed to generate embedding",
          details: embError.message || "Embedding generation failed",
          requestId
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
    }

    // 3. Match Documents with manual ownership enforcement
    const { data: documents, error: matchError } = await supabaseAdmin.rpc("au_vector_search", {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: 5,
      p_user_id: ownershipFilter.user_id || null,
      p_guest_session_id: ownershipFilter.guest_session_id || null
    });

    if (matchError) {
      return new Response(JSON.stringify({ 
        error: "Database search failed",
        details: matchError.message,
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // 4. Generate Answer using OpenRouter (Free Model)
    const context = documents?.map((d: any) => d.text).join("\n\n");
    
    const systemPrompt = "You are a helpful study assistant. Use the following context to answer the user's question. If the answer isn't in the context, say so.";
    const userPrompt = `Context: ${context}\n\nQuestion: ${question}`;

    const aiResponse = await callAU(supabaseAdmin, systemPrompt, userPrompt, 0.5, false, undefined, {
      userId: userId ?? undefined,
      ownershipFilter: ownershipFilter,
      feature: "chat-rag",
    });

    return new Response(JSON.stringify({ 
      ok: true,
      answer: aiResponse,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[chat] Error [${requestId}]:`, error);
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
