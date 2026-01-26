/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { getCorsHeaders, callAU, requireAnyAuth, emitEvent, generateEmbedding } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: any = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
  };

  try {
    corsHeaders = getCorsHeaders(req);
  } catch (e) {
    console.warn("Failed to generate CORS headers", e);
  }

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
      try {
        const embedding = await generateEmbedding(supabaseAdmin, latestMessage);

        // Filter by specific document if selectedDocId is provided
        const { selectedDocId } = body;
        
        let docIdsToSearch: string[] = [];
        if (selectedDocId) {
          docIdsToSearch.push(selectedDocId);
          
          // INTELLIGENT LINKING: Check if this is an exam question or supplement
          // If so, we must also search the PARENT textbook to answer questions correctly.
          const { data: docInfo } = await supabaseAdmin
            .from('au_documents')
            .select('document_type, parent_id')
            .eq('id', selectedDocId)
            .single();
            
          if (docInfo && docInfo.parent_id) {
            console.log(`[au-chat] Linked document detected. Including parent ${docInfo.parent_id} in search.`);
            docIdsToSearch.push(docInfo.parent_id);
          }
        }
        
        // Search - using supabaseAdmin with explicit ownership filters
        // Note: The current RPC 'au_vector_search' doesn't support an array of IDs natively in the filter logic 
        // without modification, OR we can fetch chunks for ALL user docs and filter in code (inefficient),
        // OR we rely on semantic similarity globally (p_user_id) if we want "Smart Matching".
        // 
        // Strategy: If we have specific doc IDs, we'll fetch results globally for the user 
        // and then filter for those IDs in the application layer to support the "Parent+Child" linking.
        
        const { data: chunks, error: searchError } = await supabaseAdmin.rpc("au_vector_search", {
          query_embedding: embedding,
          match_threshold: 0.65, // Lower threshold slightly to catch broader textbook concepts
          match_count: 10,       // Increase count to get both exam question AND textbook context
          p_user_id: effectiveFilter.user_id || null,
          p_guest_session_id: effectiveFilter.guest_session_id || null
        });

        if (searchError) {
          console.error("[au-chat] Vector search error:", searchError);
        }

        if (chunks && chunks.length > 0) {
          // Filter: If we have specific target docs (exam + textbook), keep only those.
          // If selectedDocId was null (search all), keep all.
          const relevantChunks = (docIdsToSearch.length > 0)
            ? chunks.filter((c: any) => docIdsToSearch.includes(c.document_id))
            : chunks;
            
          context = relevantChunks.map((c: any) => c.text).join("\n\n");
          
          // Deduplicate citations by fileName
          const uniqueFiles = new Set();
          citations = relevantChunks.reduce((acc: any[], c: any) => {
            if (!uniqueFiles.has(c.file_name)) {
              uniqueFiles.add(c.file_name);
              acc.push({ fileName: c.file_name, chunkId: c.chunk_id });
            }
            return acc;
          }, []);
          
          console.log(`[au-chat] Retrieved ${relevantChunks.length} chunks. Target Docs: ${docIdsToSearch.join(', ') || 'All'}`);
        } else {
          console.log(`[au-chat] No relevant chunks found.`);
        }
      } catch (ragError) {
        console.warn("[au-chat] RAG step failed (continuing without context):", ragError);
      }
    }

    // 3. Generate Answer
    const systemPrompt = `You are AU, the Intelligent Study Orchestrator for Datacube AU.
Your goal is to tutor the student AND guide them to the right study tools (Knowledge Hub, Exam Engine, Practice Exam).

CORE SELF-INFO:
- Role: Intelligent Study Orchestrator.
- Capabilities: Tutoring, Cross-Section Navigation, Progress Tracking.
- Personality: Smart, Proactive, Encouraging, System-Aware.

SYSTEM AWARENESS (Use this to route students):
1. **Knowledge Hub**: For deep concept mastery, summaries, and mind maps.
2. **Exam Prediction Engine**: For seeing likely questions and topic weighting.
3. **Practice Exam**: For testing knowledge, scoring, and feedback.

CURRENT CONTEXT:
- Current Path: ${currentPath || 'Dashboard'}
${logContext}

${summaryMode ? `SUMMARY MODE: You are in ${summaryMode.toUpperCase()} mode.
   - SHORT: Be extremely concise, use bullet points, max 3 sentences.
   - MID: Provide a standard explanation with balanced detail (1-2 paragraphs).
   - DETAILED: Provide a comprehensive deep-dive, including examples, quotes, and step-by-step analysis.` : ""}

DOCUMENT CONTEXT (RAG):
The following text snippets are from the user's uploaded documents. You MUST use this information to answer the question if it is relevant.
${context ? `"""\n${context}\n"""` : "No specific document context found for this query."}

ORCHESTRATION GUIDELINES (CRITICAL):
  1. **Smart Navigation**: Proactively recommend the best section based on context.
     - Learning concepts? -> "To strengthen this, I recommend the **Knowledge Hub**."
     - Asking about exams? -> "Want me to pull predictions from the **Exam Prediction Engine**?"
     - Finished a topic? -> "Ready to test this? Try a **Practice Exam** question."
  2. **Teaching + Action**: Every response must blend:
     - **Teaching**: Explain the concept clearly (using layered explanation).
     - **Assessment**: Check if they understand.
     - **Action**: Suggest a specific next step or section to visit.
  3. **Cross-Section Reporting**: Reference their activity if available (e.g., "You haven't tried the Practice Exam for this yet").
  4. **Student Confidence**:
     - Low confidence? -> Encourage, simplify, suggest **Knowledge Hub** for basics.
     - High confidence? -> Challenge them, suggest **Practice Exam** or **Prediction Engine**.
  5. **Exam Difficulty Tagging**: Tag exam discussions as [Easy/Medium/Hard].

INSTRUCTIONS:
  - Use the DOCUMENT CONTEXT to answer accurately.
  - If asked about yourself, use CORE SELF-INFO.
  - **Maintain Context**: Remember what topic is being discussed.
  - **Never Generic**: Don't just say "check the other sections". Say "Check the Knowledge Hub *to see the mind map for this*".

OUTPUT FORMAT (Strict JSON):
Return a JSON object with exactly these fields:
- "thought": A brief internal monologue (1-2 sentences) about your teaching strategy and routing decision.
- "answer": Your final response in markdown format.

Example:
{
  "thought": "User finished learning about photosynthesis. I will suggest the Practice Exam to test retention.",
  "answer": "Great job! Photosynthesis is key... **Since you've mastered the basics, shall we try a Practice Exam question to lock this in?**"
}`;

    // Construct the prompt for the LLM
    // To support persistent memory, we can append previous messages if available, 
    // but for now, the system prompt + latestMessage + RAG context is the most robust stateless approach.
    // If we want to include history, we would concatenate it to 'latestMessage' or use the 'messages' array in the LLM call.
    // Let's create a combined user prompt that includes a snippet of history if it exists.
    
    let userPrompt = latestMessage;
    if (messages.length > 1) {
       // Increase context window to last 5 messages for better continuity
       const recentHistory = messages.slice(-6, -1).map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
       if (recentHistory) {
         userPrompt = `PREVIOUS CONTEXT (Use this to understand "it", "that", or "next"):\n${recentHistory}\n\nCURRENT QUESTION:\n${latestMessage}`;
       }
    }

    const responseText = await callAU(
      supabaseAdmin,
      systemPrompt,
      userPrompt,
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
