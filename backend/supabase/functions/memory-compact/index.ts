/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { getCorsHeaders, callAU, requireUser } from "../_shared/au.ts";
import { MemoryCompactionSchema } from "../_shared/validation.ts";
import { rateLimitOrThrow } from "../_shared/rate-limit.ts";
import { consumeUsageOrThrow, LimitExceededError } from "../_shared/usage-guard.ts";
import { usageTrackingHandledByProxy } from "../_shared/usage-tracking.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: any = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };

  try {
    corsHeaders = getCorsHeaders(req);
  } catch {}

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));

    // 1. Auth
    const auth = await requireUser(req, body);
    if (auth.authError || !auth.userId) {
      return new Response(JSON.stringify({ error: "Unauthorized", requestId }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Validate
    const validation = MemoryCompactionSchema.safeParse(body);
    if (!validation.success) {
      return new Response(JSON.stringify({ error: "Invalid Schema", details: validation.error }), { status: 400, headers: corsHeaders });
    }
    const { current_digest, recent_turns } = validation.data;

    if (!usageTrackingHandledByProxy(req)) {
      await consumeUsageOrThrow(auth.supabaseAdmin, auth.userId, 'au_chat', { countInc: 1 });
    }

    // 3. Compaction
    const systemPrompt = `You are a Memory Compressor.
    TASK: Merge the current digest with recent chat turns into a new concise digest (max 700 chars).
    RULES:
    - Keep core user facts (goals, preferences, key constraints).
    - Summarize recent topics.
    - Discard trivial chatter.
    - OUTPUT ONLY RAW TEXT. No markdown, no prefixes.`;

    const userPrompt = `CURRENT DIGEST: ${current_digest || "None"}
    
    RECENT TURNS:
    ${recent_turns.map(t => `${t.role}: ${t.content}`).join('\n')}
    
    NEW DIGEST (Max 700 chars):`;

    // Use cheapest model
    const responseText = await callAU(
      auth.supabaseAdmin,
      systemPrompt,
      userPrompt,
      0.3,
      false,
      "openai/gpt-4o-mini", // Cheap & Fast
      { userId: auth.userId, feature: "memory-compact" },
      "chat"
    );

    return new Response(JSON.stringify({ 
      new_digest: responseText.substring(0, 700) 
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    if (error?.name === "LimitExceededError") {
      return new Response(JSON.stringify(error.context), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
