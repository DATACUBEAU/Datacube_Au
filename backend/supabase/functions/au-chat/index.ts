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
    
    const { messages, sessionId, useRAG = true, guide, summaryMode, currentPath, action, selectedDocId, browsingMode } = body;
    
    // --- SPECIAL ACTION: GREET & SCAN ---
    if (action === 'scan_and_greet') {
        if (!selectedDocId) {
             return new Response(JSON.stringify({ error: "selectedDocId required for greeting" }), { status: 400, headers: corsHeaders });
        }

        // Fetch larger context for a "whole document" feel (limit 20 chunks)
        const { data: chunks } = await supabaseAdmin
            .from('au_document_chunks')
            .select('text')
            .eq('document_id', selectedDocId)
            .order('chunk_index', { ascending: true })
            .limit(20);
            
        const docContext = chunks?.map((c: any) => c.text).join("\n") || "";
        
        // Fetch document name
        const { data: docInfo } = await supabaseAdmin.from('au_documents').select('file_name').eq('id', selectedDocId).single();
        const docName = docInfo?.file_name || "Document";

        const systemPrompt = `You are AU, the Intelligent Study Orchestrator.
        Your goal is to provide a BOLD, comprehensive **Startup Guide & Study Roadmap** for the student's new document.
        
        TASK:
        1. Analyze the provided document text (First 20 chunks scanned).
        2. Generate a **Study Roadmap** that breaks the content into logical phases or modules.
        3. Be BOLD, DIRECT, and ENCOURAGING. Do NOT use "AI", refer to yourself as "AU".
        
        OUTPUT FORMAT (JSON):
        {
          "thought": "I have scanned the document. It covers X, Y, Z. I will outline a 3-step roadmap.",
          "answer": "Greeting message..."
        }
        
        GREETING TEMPLATE (Markdown):
        "# 🚀 Welcome to your Study Space for **${docName}**!
        
        I've scanned your document and generated a custom **Study Roadmap** to get you started:
        
        ### 📍 Phase 1: Core Concepts
        [Brief list of key topics found]
        
        ### 📍 Phase 2: Deep Dive
        [Advanced topics or details found]
        
        ### 📍 Phase 3: Mastery & Testing
        [Suggestions for Practice Exams/Predictions]
        
        **Ready to begin?** Pick a phase or ask me anything!"
        `;

        const responseText = await callAU(supabaseAdmin, systemPrompt, `Document Content (Start):\n${docContext}`, 0.5, true);
        let finalResponse = { answer: responseText, thought: "" };
        try {
            const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            finalResponse = JSON.parse(cleaned);
        } catch {
             finalResponse = { answer: responseText, thought: "Generated greeting." };
        }
        
        return new Response(JSON.stringify({ 
            ok: true, 
            answer: finalResponse.answer, 
            thought: finalResponse.thought,
            requestId 
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- NORMAL CHAT ---
    
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
    // SKIP RAG if browsingMode is ON to avoid context pollution, OR keep it? 
    // Usually browsing implies looking outside. But user might want "updates on THIS topic".
    // Let's keep RAG but prioritized lower or explicitly labeled.
    if (useRAG) {
      try {
        const embedding = await generateEmbedding(supabaseAdmin, latestMessage);

        // Filter by specific document if selectedDocId is provided
        
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
- Capabilities: Tutoring, Cross-Section Navigation, Progress Tracking${browsingMode ? ", Internet Browsing (via Perplexity)" : ""}.
- Personality: Smart, Proactive, Encouraging, System-Aware.

SYSTEM AWARENESS (Use this to route students):
1. **Knowledge Hub**: For deep concept mastery, summaries, and mind maps.
2. **Exam Prediction Engine**: For seeing likely questions and topic weighting.
3. **Practice Exam**: For testing knowledge, scoring, and feedback.

CURRENT CONTEXT:
- Current Path: ${currentPath || 'Dashboard'}
- Browsing Mode: ${browsingMode ? "ENABLED (External sources allowed)" : "DISABLED (Strictly uploaded documents only)"}
${logContext}

${summaryMode ? `SUMMARY MODE: You are in ${summaryMode.toUpperCase()} mode.
   - SHORT: Be extremely concise, use bullet points, max 3 sentences.
   - MID: Provide a standard explanation with balanced detail (1-2 paragraphs).
   - DETAILED: Provide a comprehensive deep-dive, including examples, quotes, and step-by-step analysis.` : ""}

DOCUMENT CONTEXT (RAG):
The following text snippets are from the user's uploaded documents. You MUST use this information to answer the question if it is relevant.
${context ? `"""\n${context}\n"""` : "No specific document context found for this query."}

BEHAVIORAL INTELLIGENCE (MANDATORY):
  1. **Intent Classification**:
     - Before replying, classify the user's intent in your "thought": [Confused | Exploratory | Assessment-Ready | Finished | Idle].
  2. **Mandatory Engagement Loop**:
     - Every response must follow this flow: **Explain** (Answer the query) → **Check** (Verify understanding) → **Suggest** (Propose next action/tool).
     - Example: "The mitochondria is the powerhouse... Does that make sense? We can explore its structure in the **Knowledge Hub** next."
  3. **Confusion Recovery Mode**:
     - If the user says "I don't know", "what now", or is vague:
     - **NEVER** say "I don't understand".
     - **ALWAYS** offer 2-4 guided options.
     - Example: "No worries! We can: 1) Summarize the next chapter, 2) Quiz you on the basics, or 3) Explore exam predictions."
  4. **Source Discipline**:
     - **Textbook Answers**: Use ONLY the provided Document Context. Do not hallucinate.
     - **Exam Sync**: If asking about exams, combine Textbook info with Exam Prediction Engine knowledge.
     - **No Artifacts**: Never output filenames like "demo_note.txt" in the final answer.
  5. **Explainability Mode**:
     - Occasionally explain *why* you recommend a tool.
     - Example: "I recommend the **Exam Prediction Engine** *because this topic appears frequently in past papers*."
  6. **Browsing Transparency**:
     - If Browsing Mode is ON: You MUST explicitly state: "I've checked external sources..." and list the domain/source if possible.
     - If Browsing Mode is OFF: Explicitly state "Based on your documents..." if the answer is limited.

INSTRUCTIONS:
  - Use the DOCUMENT CONTEXT to answer accurately.
  - If asked about yourself, use CORE SELF-INFO.
  - **Maintain Context**: Remember what topic is being discussed.
  - **Never Generic**: Don't just say "check the other sections". Say "Check the Knowledge Hub *to see the mind map for this*".

OUTPUT FORMAT (Strict JSON):
Return a JSON object with exactly these fields:
- "thought": A brief internal monologue (1-2 sentences) including your Intent Classification and routing decision.
- "answer": Your final response in markdown format.

Example:
{
  "thought": "[Assessment-Ready] User understands the basics. I will suggest the Practice Exam.",
  "answer": "Exactly! The mitochondria... **Since you've got this down, shall we try a Practice Exam question to test your knowledge?**"
}`;

    // Construct the prompt for the LLM
    let userPrompt = latestMessage;
    if (messages.length > 1) {
       // Increase context window to last 5 messages for better continuity
       const recentHistory = messages.slice(-6, -1).map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
       if (recentHistory) {
         userPrompt = `PREVIOUS CONTEXT (Use this to understand "it", "that", or "next"):\n${recentHistory}\n\nCURRENT QUESTION:\n${latestMessage}`;
       }
    }

    // Browsing Mode Override
    // Use a model with internet access if browsing is enabled
    const modelOverride = browsingMode ? "perplexity/llama-3.1-sonar-large-128k-online" : undefined;

    const responseText = await callAU(
      supabaseAdmin,
      systemPrompt,
      userPrompt,
      0.5,
      false, // Disable JSON mode to avoid 400 errors with some free models
      modelOverride,
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
      finalResponse = { answer: responseText, thought: "Analyzing...", citations };
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
