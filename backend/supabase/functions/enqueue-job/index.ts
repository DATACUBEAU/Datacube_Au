/// <reference path="../deno.d.ts" />
import { requireAnyAuth, getCorsHeaders } from "../_shared/au.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);
  
  // 1. Handle CORS preflight IMMEDIATELY
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { ownershipFilter, supabaseAdmin, error: authError } = await requireAnyAuth(req, body);

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

    const { 
      document_id, 
      file_name, 
      file_size_bytes, 
      bucket = "documents", 
      object_path 
    } = body;

    if (!document_id || !file_name || !file_size_bytes || !object_path) {
      return new Response(JSON.stringify({ 
        error: "Missing required fields",
        details: `Expected: document_id, file_name, file_size_bytes, object_path. Received: ${JSON.stringify({ document_id, file_name, file_size_bytes, object_path })}`,
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 1. Create the job in queued status
    const { data: job, error: jobError } = await supabaseAdmin
      .from("au_upload_jobs")
      .insert({
        document_id,
        file_name,
        file_size_bytes,
        bucket,
        object_path,
        status: "queued",
        ...ownershipFilter
      })
      .select()
      .single();

    if (jobError) throw jobError;

    return new Response(JSON.stringify({ 
      ok: true, 
      jobId: job.id,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[enqueue-job] Error [${requestId}]:`, error);
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
