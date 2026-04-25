/// <reference path="../deno.d.ts" />
import { getCorsHeaders } from "../_shared/au.ts";

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
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
      return new Response(JSON.stringify({ 
        error: "Unauthorized",
        details: "Invalid service role key",
        requestId
      }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Execute SQL (using postgres.js or similar if available, OR via Supabase Client if RPC exists)
    // Actually, Edge Runtime doesn't have direct PG access easily without a driver. 
    // But we can use the Supabase Client to call an RPC if it exists, OR we can use the `postgres` library if imported.
    // The previous implementation likely used a postgres driver or assumed an RPC.
    
    // Let's assume we want to use the Supabase Client to run a query? No, client can't run raw SQL.
    // We need a postgres driver.
    
    // Wait, the file I read earlier didn't show the implementation of the SQL execution! 
    // It just showed the "Disabled" return.
    // I need to see what's BELOW the disabled block.
    
    // Let's read the full file first.
    return new Response(JSON.stringify({ 
      error: "Disabled",
      details: "Raw SQL execution is disabled via this function.",
      requestId
    }), { 
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error(`[run-sql] Error [${requestId}]:`, error);
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
