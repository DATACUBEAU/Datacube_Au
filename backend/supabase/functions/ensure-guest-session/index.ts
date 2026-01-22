import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/au.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    // Hash IP and User Agent for fingerprinting
    const fingerprintHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(ua)
    );
    const fingerprintHex = Array.from(new Uint8Array(fingerprintHash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const ipHashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(ip)
    );
    const ipHashHex = Array.from(new Uint8Array(ipHashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Check if a session already exists for this fingerprint/IP
    const { data: existingSession, error: fetchError } = await supabase
      .from("au_guest_sessions")
      .select("id")
      .eq("fingerprint", fingerprintHex)
      .eq("ip_hash", ipHashHex)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existingSession) {
      return new Response(
        JSON.stringify({ 
          ok: true, 
          guest_session_id: existingSession.id,
          requestId 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Rate Limit Check (Max 5 sessions / IP / 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("au_guest_sessions")
      .select("*", { count: "exact", head: true })
      .eq("ip_hash", ipHashHex)
      .gte("created_at", yesterday);

    if (countError) throw countError;

    if ((count ?? 0) >= 5) {
      return new Response(
        JSON.stringify({ 
          error: "Guest session limit reached. Please sign in.",
          details: "You have created the maximum number of guest sessions allowed per day.",
          requestId
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create New Session
    const { data: newSession, error: insertError } = await supabase
      .from("au_guest_sessions")
      .insert({
        fingerprint: fingerprintHex,
        ip_hash: ipHashHex,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({ 
        ok: true, 
        guest_session_id: newSession.id,
        requestId 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error(`[ensure-guest-session] Error [${requestId}]:`, error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Internal server error",
        details: error.stack || String(error),
        requestId
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
