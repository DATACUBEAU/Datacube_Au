// @ts-ignore: Deno modules
import { getCorsHeaders, callAU, requireUser, emitEvent, generateEmbedding, getServiceClient } from "../_shared/au.ts";
import { searchQdrant } from "../_shared/qdrant.ts";
import { consumeUsageOrThrow, LimitExceededError } from "../_shared/usage-guard.ts";
import { usageTrackingHandledByProxy } from "../_shared/usage-tracking.ts";

async function hashKey(text: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

Deno.serve(async (req: Request) => {
    const start = performance.now();
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

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const requestId = crypto.randomUUID();
    let userId: string | null = null;
    let ownershipFilter: any = null;
    let supabaseAdmin: any = null;

    try {
        // Rate Limiting Logic
        const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
        const MAX_REQUESTS = 20; // 20 requests per minute per IP

        const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";

        supabaseAdmin = getServiceClient();

        // Check Rate Limit
        const now = new Date();
        const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW).toISOString();

        // Clean old entries (optimistic cleanup)
        // await supabaseAdmin.from('au_rate_limits').delete().lt('created_at', windowStart); 
        // We can skip explicit delete for speed and rely on cron or periodic cleanup, but let's do a quick count check.

        const { count } = await supabaseAdmin
            .from('au_rate_limits')
            .select('*', { count: 'exact', head: true })
            .eq('identifier', ip)
            .eq('endpoint', 'chat')
            .gt('created_at', windowStart);

        if ((count || 0) >= MAX_REQUESTS) {
            console.warn(`[RateLimit] IP ${ip} exceeded limit (${count}).`);
            return new Response(JSON.stringify({ 
                error: "Rate limit exceeded. Please wait a moment.", 
                code: "RATE_LIMIT_EXCEEDED" 
            }), { status: 429, headers: corsHeaders });
        }

        // Log Request
        await supabaseAdmin.from('au_rate_limits').insert({ identifier: ip, endpoint: 'chat' });

        const body = await req.json().catch(() => ({}));
        const auth = await requireUser(req, body);
        userId = auth.userId;
        ownershipFilter = userId ? { user_id: userId } : null;
        if (!userId) {
            return new Response(JSON.stringify({ error: "Unauthorized", details: "Authentication required", requestId }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (!usageTrackingHandledByProxy(req)) {
            await consumeUsageOrThrow(supabaseAdmin, userId, 'au_chat', { countInc: 1 });
        }

        const { messages, selectedDocId, browsingMode, policyVersion = "v1" } = body;

        const question = messages?.[messages.length - 1]?.content;

        if (!question) throw new Error("No question provided");

        // 1. FAST PATH ROUTER
        // Heuristic Classification
        const lowerQ = question.toLowerCase();
        let route = "RAG_LLM"; // Default
        
        if (lowerQ.match(/billing|plan|limit|tier|subscription|settings/)) {
            route = "NO_LLM";
        } else if (lowerQ.length < 15 && !selectedDocId && lowerQ.match(/^(hi|hello|hey|yo|help)$/)) {
            route = "LLM_ONLY";
        }

        // 2. CACHE CHECK (Aggressive)
        // Cache Key: User + Doc + Question + Policy
        const cacheKeyRaw = `${userId}:${selectedDocId || 'global'}:${question}:${policyVersion}`;
        const cacheKey = await hashKey(cacheKeyRaw);
        
        // Check Cache DB
        const { data: cached } = await supabaseAdmin
            .from('au_answer_cache')
            .select('*')
            .eq('cache_key', cacheKey)
            .maybeSingle();

        if (cached) {
            // Log Cache Hit
             await emitEvent(supabaseAdmin, {
                event_type: 'chat_completed',
                entity_id: 'cache-hit',
                user_id: userId,
                metadata: { 
                    latency_ms: performance.now() - start,
                    cache_hit: true,
                    route
                }
            });

            return new Response(JSON.stringify({
                ok: true,
                answer: cached.answer,
                citations: cached.citations || [],
                cached: true,
                thought: "Cache Hit"
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 3. EXECUTE ROUTE
        let answer = "";
        let citations: any[] = [];
        let thought = "";
        let context = "";
        
        if (route === "NO_LLM") {
            // Fetch billing info (mock for now)
            answer = "You are currently on the Standard Tier. To view limits, check your account settings.";
            thought = "Routed to NO_LLM (Billing Query)";
        } else if (route === "LLM_ONLY") {
            answer = await callAU(supabaseAdmin, "You are a helpful assistant.", question, 0.5, false, undefined, { userId, feature: "au-answer" });
            thought = "Routed to LLM_ONLY (Casual)";
        } else {
            // RAG_LLM (Default)
            
            // Retrieval Budgeting
            // Max 6 chunks, Max 1200 tokens context
            const queryEmbedding = await generateEmbedding(supabaseAdmin, question);
             
            const qdrantFilter: any = { must: [], should: [] };
            qdrantFilter.must.push({ key: "user_id", match: { value: userId } });
             
            if (selectedDocId) {
                qdrantFilter.must.push({ key: "document_id", match: { value: selectedDocId } });
                
                // Include parent if linked
                const { data: docInfo } = await supabaseAdmin
                    .from('au_documents')
                    .select('parent_id')
                    .eq('id', selectedDocId)
                    .single();
                if (docInfo?.parent_id) {
                     qdrantFilter.must.push({
                        should: [
                            { key: "document_id", match: { value: selectedDocId } },
                            { key: "document_id", match: { value: docInfo.parent_id } }
                        ]
                     });
                }
            }

            const qdrantResults = await searchQdrant(queryEmbedding, {
                 limit: 6, // Budget: Max 6
                 score_threshold: 0.75, // Stricter
                 filter: qdrantFilter
            });
             
            // Context Budgeting (Approx 1200 tokens ~ 4800 chars)
            let currentChars = 0;
            const MAX_CHARS = 5000;
             
            const usedChunks: any[] = [];
             
            if (qdrantResults) {
                 for (const res of qdrantResults) {
                     if (currentChars + res.payload.text.length > MAX_CHARS) break;
                     usedChunks.push(res);
                     currentChars += res.payload.text.length;
                 }
                 
                 context = usedChunks.map(c => c.payload.text).join("\n\n");
                 
                 // Deduplicate citations
                 const seen = new Set();
                 citations = usedChunks.reduce((acc: any[], c) => {
                     if (!seen.has(c.payload.document_id)) {
                         seen.add(c.payload.document_id);
                         acc.push({ documentId: c.payload.document_id, chunkId: c.id, score: c.score });
                     }
                     return acc;
                 }, []);
            }

            // Generate Answer with Output Control
            const systemPrompt = `You are AU. Concise, accurate, helpful. 
            CONTEXT:
            ${context || "No specific context found."}
             
            Rules:
            - Answer the question based on context.
            - If context is missing, say so.
            - **Output Control**:
              - Max 8-12 lines.
              - Use bullet points.
              - No long explanations unless asked.
              - Use "ask-to-expand" pattern: "Want the detailed version?" if answer is long.
            `;
             
            answer = await callAU(supabaseAdmin, systemPrompt, question, 0.3, false, undefined, { userId, feature: "au-answer" });
            thought = `Routed to RAG_LLM. Used ${usedChunks.length} chunks.`;
        }

        // 4. CACHE & LOG & HISTORY
        const dbPromises: Promise<any>[] = [];

        // Store in Cache (if not NO_LLM and answer is valid)
        if (route !== "NO_LLM" && answer) {
            dbPromises.push(
                supabaseAdmin.from('au_answer_cache').insert({
                    cache_key: cacheKey,
                    user_id: userId,
                    answer,
                    citations,
                    policy_version: policyVersion
                })
            );
        }

        // Save to History (au_messages)
        if (selectedDocId && selectedDocId !== 'global') { // Don't save global chat to session if no session?
             // Actually global chat has a hardcoded ID 'global'. 
             // But `au_messages` requires a `session_id` which links to `au_sessions`.
             // Does a session with id 'global' exist?
             // If not, we might skip saving or create one.
             // For now, let's safe-guard.
             if (ownershipFilter) {
                 const clientIds = messages.length > 0 && messages[messages.length-1].id ? [messages[messages.length-1].id] : [];
                 const assistantMessageId = crypto.randomUUID();
                 
                 const rowsToUpsert = [
                    { 
                        session_id: selectedDocId, 
                        ...ownershipFilter,
                        role: "user", 
                        content: question,
                        client_message_id: clientIds[0] || null
                    },
                    { 
                        session_id: selectedDocId, 
                        ...ownershipFilter,
                        role: "assistant", 
                        content: answer, 
                        metadata: { citations, thought },
                        client_message_id: null // We don't have a client ID for the assistant response yet
                    }
                ];
                
                // We use a lenient insert/upsert
                dbPromises.push(
                    supabaseAdmin.from("au_messages")
                        .upsert(rowsToUpsert, { onConflict: "session_id,client_message_id" }) // This might fail if session doesn't exist
                        .catch((e: any) => console.warn("History save failed (non-critical):", e.message))
                );
             }
        }

        // Log Event
        dbPromises.push(emitEvent(supabaseAdmin, {
            event_type: 'chat_completed',
            entity_id: requestId,
            user_id: userId,
            metadata: { 
                latency_ms: performance.now() - start,
                cache_hit: false,
                route,
                token_usage: answer.length / 4 
            }
        }));

        await Promise.all(dbPromises);

        return new Response(JSON.stringify({
            ok: true,
            answer,
            citations,
            thought,
            requestId
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error: any) {
        console.error(`[au-answer] Error:`, error);

        if (error?.name === "LimitExceededError") {
            return new Response(JSON.stringify(error.context), {
                status: 402,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
        return new Response(JSON.stringify({ 
            error: error.message || "Internal Server Error",
            details: error.details || String(error)
        }), { 
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
