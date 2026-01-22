/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { getCorsHeaders, callAU, requireAnyAuth, emitEvent } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";

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

    // If no ownership filter, we might still proceed but with no data access if RLS was on.
    // Since user wants RLS disabled, we'll allow it but logs/RAG will be empty or limited.
    const effectiveFilter = (ownershipFilter || {}) as any;
    
    const { messages, sessionId, useRAG = true, guide, summaryMode, currentPath } = body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ 
        error: "Missing or empty messages array",
        details: "A non-empty messages array is required",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const latestMessage = messages[messages.length - 1]?.content;
    if (!latestMessage) {
      return new Response(JSON.stringify({ 
        error: "Latest message content is empty",
        details: "The content of the latest message cannot be empty",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 1. Fetch Context (RAG + Logs + Path)
    let context = "";
    let citations: any[] = [];
    
    // Fetch recent logs for context using explicit ownership filter
    const { data: logs } = await supabaseAdmin
      .from('au_upload_jobs')
      .select('file_name, status, created_at')
      .match(effectiveFilter)
      .order('created_at', { ascending: false })
      .limit(3);
    
    let logContext = "";
    if (logs && logs.length > 0) {
      logContext = "\nRecent Activity:\n" + logs.map((l: any) => `- ${l.file_name}: ${l.status} (${new Date(l.created_at).toLocaleDateString()})`).join("\n");
    }

    // 2. RAG Step (if enabled)
    if (useRAG) {
      const openAiKey = await getApiKey(supabaseAdmin, "openai");

      // Embed Query
      const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          input: latestMessage,
          model: "text-embedding-ada-002",
        }),
      });

      if (embeddingResponse.ok) {
        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;

        // Search - using supabaseAdmin with explicit ownership filters
        const { data: chunks, error: searchError } = await supabaseAdmin.rpc("au_vector_search", {
          query_embedding: embedding,
          match_threshold: 0.7,
          match_count: 5,
          p_user_id: effectiveFilter.user_id || null,
          p_guest_session_id: effectiveFilter.guest_session_id || null
        });

        if (searchError) {
          console.error("[au-chat] Vector search error:", searchError);
        }

        if (chunks && chunks.length > 0) {
          context = chunks.map((c: any) => c.text).join("\n\n");
          citations = chunks.map((c: any) => ({ fileName: c.file_name, chunkId: c.chunk_id }));
        }
      }
    }

    // 3. Generate Answer
    const systemPrompt = `You are AU, an advanced Analytical Unit assistant within the Datacube AU domain. 
Your goal is to provide highly intelligent, accurate, and analytical answers based on the user's data and current context.

CORE SELF-INFO:
- Creator: Fabian, the visionary behind Analytical Unit.
- Domain: Datacube AU (a specialized domain of Analytical Unit).
- Personality: Professional, analytical, helpful, and concise.

CURRENT CONTEXT:
- Current Path: ${currentPath || 'Dashboard'}
${logContext}

${guide ? `USER PREFERENCES (Follow these strictly):\n${guide}\n` : ""}
${summaryMode ? `SUMMARY MODE: You are in ${summaryMode} mode. Adjust your response length accordingly.\n` : ""}

DOCUMENT CONTEXT (RAG):
${context || "No specific document context found for this query."}

INSTRUCTIONS:
  1. Use the provided DOCUMENT CONTEXT to answer the user's question if applicable.
  2. If the user asks about themselves (e.g., "my logs", "what was I doing?"), refer to the Recent Activity provided above.
  3. If the user asks about you (creator, origin, name), use the CORE SELF-INFO provided.
  4. If the question is about the current page/path, explain what the user can do there.
  5. Always maintain the "AU" identity. Never refer to yourself as AI.
  6. If the user asks about your creator, it is Fabian.
  7. You are a Domain of Analytical Unit.
  8. If you don't know the answer, say so clearly.

OUTPUT FORMAT (Strict JSON):
Return a JSON object with exactly these fields:
- "thought": A brief internal monologue (1-2 sentences) about how you analyzed the context and which information you prioritized.
- "answer": Your final response in markdown format.

Example:
{
  "thought": "I noticed the user is on the chat page and has a recently failed upload. I will address their question while also mentioning the upload status.",
  "answer": "Hello! I am AU. I see you are asking about..."
}`;

    const responseText = await callAU(
      supabaseAdmin,
      systemPrompt,
      latestMessage,
      0.5,
      false, // Disable JSON mode to avoid 400 errors with some free models
      undefined,
      { userId: userId || undefined, ownershipFilter, feature: "au-chat", sessionId }
    );

    let finalResponse = { answer: responseText, thought: "", citations };
    try {
      // Clean up potential markdown code blocks
      const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      finalResponse = { 
        answer: parsed.answer || responseText, 
        thought: parsed.thought || "",
        citations 
      };
    } catch (e) {
      // Fallback if AU doesn't return valid JSON
      finalResponse = { answer: responseText, thought: "Analyzing document content...", citations };
    }

    // 4. Save to History (Phase 4 requirement)
    if (sessionId) {
      // Verify session ownership before inserting message
      const { data: session } = await supabaseAdmin
        .from("au_sessions")
        .select("id")
        .eq("id", sessionId)
        .match(ownershipFilter)
        .single();

      if (session) {
        await supabaseAdmin.from("au_messages").insert([
          { 
            session_id: sessionId, 
            ...ownershipFilter,
            role: "user", 
            content: latestMessage 
          },
          { 
            session_id: sessionId, 
            ...ownershipFilter,
            role: "assistant", 
            content: finalResponse.answer, 
            metadata: { citations, thought: finalResponse.thought } 
          }
        ]);
      }
    }

    // 5. Emit Sync Event
    await emitEvent(supabaseAdmin, {
      event_type: 'chat_completed',
      entity_id: sessionId || 'new-session',
      user_id: userId || 'anonymous',
      metadata: { 
        messageCount: messages.length,
        hasContext: !!context,
        citationCount: citations.length
      }
    });

    return new Response(JSON.stringify({ 
      ok: true,
      answer: finalResponse.answer, 
      thought: finalResponse.thought,
      citations,
      sessionId,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[au-chat] Error [${requestId}]:`, error);
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
