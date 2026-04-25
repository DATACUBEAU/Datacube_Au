import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, corsHeaders, getServiceClient } from "../_shared/au.ts";

function isMissingColumnError(error: any): boolean {
  const code = String(error?.code ?? "").trim();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || (message.includes("column") && message.includes("does not exist"));
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId, authError } = await validateAuth(req);
    if (authError || !userId) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const body = await req.json();
    const { name, params, event_type, metadata } = body;

    // Harmonize input
    // Support both new {name, params} and old {event_type, metadata}
    const finalEventName = name || event_type;
    const finalParams = params || metadata || {};
    
    if (!finalEventName) {
         throw new Error("Missing event name/type");
    }

    const supabaseAdmin = getServiceClient();
    const nowIso = new Date().toISOString();
    const entityId =
      firstNonEmptyString(
        body?.entity_id,
        body?.entityId,
        finalParams?.entity_id,
        finalParams?.entityId,
      ) ?? `${String(finalEventName)}:${Date.now()}`;

    const basePayload: Record<string, unknown> = {
      user_id: userId,
      event_type: finalEventName,
      entity_id: entityId,
      metadata: finalParams,
      timestamp: nowIso,
      created_at: nowIso,
    };

    let insertError: any = null;
    let insertRes = await supabaseAdmin.from('au_events').insert(basePayload);
    insertError = insertRes.error;

    if (insertError && isMissingColumnError(insertError)) {
      // Fallback for legacy schemas without created_at/timestamp parity.
      const fallbackPayload: Record<string, unknown> = {
        user_id: userId,
        event_type: finalEventName,
        entity_id: entityId,
        metadata: finalParams,
      };
      insertRes = await supabaseAdmin.from('au_events').insert(fallbackPayload);
      insertError = insertRes.error;
    }

    if (insertError) {
      throw new Error(`Failed to insert au_events row: ${insertError.message || String(insertError)}`);
    }

    return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'log_event_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
