/// <reference path="../deno.d.ts" />
import { getCorsHeaders } from "../_shared/au.ts";
// @ts-ignore: Deno modules
import postgres from "https://deno.land/x/postgresjs@v3.3.5/mod.js";

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
    const migrationToken = req.headers.get("X-Migration-Token");
    
    if (migrationToken !== "super-secret-migration-token") {
      return new Response(JSON.stringify({ 
        error: "Unauthorized",
        details: "Invalid migration token",
        requestId
      }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      return new Response(JSON.stringify({ 
        error: "Configuration error",
        details: "SUPABASE_DB_URL not found",
        requestId
      }), { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const sql = postgres(dbUrl);

    try {
      console.log(`[apply-migration] Applying migrations [${requestId}]...`);
      
      // Add metadata columns
      await sql`ALTER TABLE au_documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE au_upload_jobs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE au_guest_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`;

      // Ensure guest_session_id exists in au_upload_jobs
      await sql`ALTER TABLE au_upload_jobs ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE au_upload_jobs ALTER COLUMN user_id DROP NOT NULL`;

      console.log(`[apply-migration] Migrations applied successfully [${requestId}]`);
      return new Response(JSON.stringify({ 
        ok: true,
        requestId
      }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } catch (err: any) {
      console.error(`[apply-migration] Migration error [${requestId}]:`, err);
      return new Response(JSON.stringify({ 
        error: "Migration failed",
        details: err.message,
        requestId
      }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } finally {
      await sql.end();
    }
  } catch (error: any) {
    console.error(`[apply-migration] Unexpected error [${requestId}]:`, error);
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
