/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
// @ts-ignore: Deno modules
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.9.1/mod.ts";
import { corsHeaders } from "../_shared/au.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeadersWithJson = { ...corsHeaders, "Content-Type": "application/json" };

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

    // Handle PATCH for heartbeat
    if (req.method === "PATCH") {
      const { action, guestId } = await req.json();
      if (action === "heartbeat" && guestId) {
        const { error: updateError } = await supabase
          .from("au_guest_sessions")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", guestId);

        if (updateError) throw updateError;
        
        return new Response(JSON.stringify({ ok: true, requestId }), {
          headers: corsHeadersWithJson,
          status: 200,
        });
      }
    }

    // 1. Hash IP and Fingerprint
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

    // 2. Rate Limit Check (Max 10 sessions / IP / 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { count, error: countError } = await supabase
      .from("au_guest_sessions")
      .select("*", { count: "exact", head: true })
      .eq("ip_hash", ipHashHex)
      .gte("created_at", yesterday);

    if (countError) {
      return new Response(JSON.stringify({ 
        error: "Rate limit check failed",
        details: countError.message,
        requestId
      }), {
        status: 500,
        headers: corsHeadersWithJson,
      });
    }

    if ((count ?? 0) >= 10) {
      return new Response(JSON.stringify({ 
        error: "Guest session limit reached",
        details: "Try again tomorrow or sign in.",
        requestId
      }), {
        status: 429,
        headers: corsHeadersWithJson,
      });
    }

    // 3. Create Session
    const { data: session, error: insertError } = await supabase
      .from("au_guest_sessions")
      .insert({
        fingerprint: fingerprintHex,
        ip_hash: ipHashHex,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ 
        error: "Failed to create session",
        details: insertError.message,
        requestId
      }), {
        status: 500,
        headers: corsHeadersWithJson,
      });
    }

    // 4. Generate Custom JWT
    const jwtSecret = Deno.env.get("JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET");
    
    if (!jwtSecret) {
      return new Response(JSON.stringify({ 
        error: "Server configuration error",
        details: "Missing JWT_SECRET",
        requestId
      }), {
        status: 500,
        headers: corsHeadersWithJson,
      });
    }

    // Create the key for signing
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const payload = {
      aud: "authenticated",
      role: "authenticated",
      sub: session.id, 
      exp: getNumericDate(24 * 60 * 60), // 24 hours
      guest_session_id: session.id, // Custom claim for RLS
      app_metadata: {
        provider: "guest_system",
      },
      user_metadata: {
        is_guest: true,
      },
    };

    const token = await create({ alg: "HS256", typ: "JWT" }, payload, key);

    return new Response(
      JSON.stringify({ 
        ok: true,
        session_id: session.id, 
        access_token: token,
        requestId
      }),
      { 
        headers: corsHeadersWithJson,
        status: 200 
      }
    );

  } catch (error: any) {
    console.error(`[guest-session] Error [${requestId}]:`, error);
    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error",
      details: error.stack || String(error),
      requestId
    }), {
      headers: corsHeadersWithJson,
      status: error.status || 500,
    });
  }
});
