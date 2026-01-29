/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders, requireAnyAuth } from "../_shared/au.ts";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB limit

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  // Initialize corsHeaders with default values in case getCorsHeaders fails
  let corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
  };

  try {
    // Try to get proper CORS headers
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

    // 1. Parse body (expect JSON)
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      console.error("Failed to parse JSON body:", e);
      return new Response(JSON.stringify({ 
        error: "Invalid JSON body. This function now only accepts JSON metadata."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    let fileName = body.fileName || body.file_name || body.filename;
    let filePath = body.filePath || body.file_path;
    let fileSize = body.fileSize || body.file_size || 0;
    const guestSessionId = body.guestSessionId || body.guest_session_id;
    const jobId = body.jobId || body.job_id;
    const documentId = body.documentId || body.document_id;
    const parentId = body.parentId || body.parent_id;
    let expiresAt = body.expiresAt || body.expires_at;
    const documentTypeRaw = body.documentType || body.document_type || "main_textbook";
    const metadata = body.metadata || {};
    const mimeType = body.mimeType || body.mime_type;

    // Normalize documentType (e.g., "Main Textbook" -> "main_textbook")
    const documentType = (documentTypeRaw || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_") || "main_textbook";

    // 2. Validate Auth
    const { userId, ownershipFilter, supabaseAdmin: supabase, authError } = await requireAnyAuth(req, body);

    if (authError) {
      return new Response(JSON.stringify({ 
        error: authError || "Authentication failed"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const effectiveUserId = userId || guestSessionId;

    // 3. Handle raw content fallback (for small diagnostic payloads)
    if (body.content && !filePath) {
      const fileData = new TextEncoder().encode(body.content);
      fileSize = fileData.length;
      if (!fileName) fileName = `content-${Date.now()}.txt`;
      
      const bucket = Deno.env.get("SUPABASE_BUCKET") || Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") || "documents";
      let folder = "uploads";
      if (documentType === "main_textbook") folder = "textbooks";
      else if (documentType === "supplementary") folder = "supplementary";
      
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      filePath = `${effectiveUserId}/${folder}/${safeFileName}`;
      
      console.log(`[document-upload] Small content upload detected. Saving to ${filePath}...`);
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, fileData, {
          contentType: "text/plain",
          upsert: true,
        });

      if (uploadError) throw uploadError;
    }

    // 4. Validate required fields
    if (!fileName || !filePath) {
      return new Response(JSON.stringify({ 
        error: "Missing required fields: fileName and filePath (or content) are required."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const effectiveFilter = ownershipFilter || (guestSessionId ? { guest_session_id: guestSessionId } : {});
    
    if (!effectiveUserId) {
      throw new Error("Could not determine owner (userId or guestSessionId missing)");
    }

    // 4. Inheritance Logic
    if (parentId && !expiresAt) {
      const { data: parentDoc, error: parentError } = await supabase
        .from("au_documents")
        .select("expires_at")
        .eq("id", parentId)
        .single();
      
      if (!parentError && parentDoc?.expires_at) {
        expiresAt = parentDoc.expires_at;
      }
    }

    if (!expiresAt) {
      const ttlMs = (effectiveFilter as any)?.guest_session_id
        ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
      expiresAt = new Date(Date.now() + ttlMs).toISOString();
    }

    // 5. Success Response if file is already uploaded (handled by client)
    // We already verified filePath above.

    // 6. Register/Update in Database (Atomic step 1)
    const docId = documentId || crypto.randomUUID();
    const docPayload: any = {
      id: docId,
      file_name: fileName,
      file_path: filePath,
      document_type: documentType,
      status: "uploaded",
      parent_id: parentId || null,
      expires_at: expiresAt || null,
      metadata,
      ...effectiveFilter
    };

    console.log(`[document-upload] Registering document ${docId}...`);
    const { data: doc, error: dbError } = await supabase
      .from("au_documents")
      .upsert(docPayload)
      .select()
      .single();

    if (dbError) {
      console.error(`[document-upload] au_documents upsert failed:`, dbError);
      throw dbError;
    }
    console.log(`[document-upload] Document registered: ${doc.id}`);

    // 7. Enqueue/Update Job (Atomic step 2)
    console.log(`[document-upload] Enqueueing job for document ${doc.id}...`);
    const jobData: any = {
      id: jobId || crypto.randomUUID(),
      document_id: doc.id,
      file_name: fileName,
      file_size_bytes: fileSize,
      mime_type: mimeType || (fileName?.endsWith(".pdf") ? "application/pdf" : "text/plain"),
      label: documentType,
      bucket: Deno.env.get("SUPABASE_BUCKET") || Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") || "documents",
      object_path: filePath,
      status: "queued",
      updated_at: new Date().toISOString(),
    };
    
    // Add ownership fields explicitly
    const filter = effectiveFilter as any;
    if (filter.user_id) jobData.user_id = filter.user_id;
    if (filter.guest_session_id) jobData.guest_session_id = filter.guest_session_id;

    const { data: job, error: jobError } = await supabase
      .from("au_upload_jobs")
      .upsert(jobData)
      .select()
      .single();

    if (jobError) throw jobError;

    // 8. Trigger processing asynchronously
    // Use EdgeRuntime.waitUntil to ensure the request is sent even after the response is returned
    const procUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-upload-job`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (serviceKey) {
      console.log(`[document-upload] Triggering processing for job ${job.id} asynchronously...`);
      const triggerPromise = fetch(procUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: job.id }),
      })
      .then(res => {
        if (!res.ok) console.error(`[document-upload] Trigger response status: ${res.status}`);
        else console.log(`[document-upload] Triggered processing for job ${job.id}`);
      })
      .catch(err => console.error(`[document-upload] Async trigger failed for job ${job.id}:`, err));

      // @ts-ignore - EdgeRuntime is available in the environment
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(triggerPromise);
      } else {
        // Fallback: await it (might delay response slightly but ensures delivery)
        await triggerPromise;
      }
    }

    // 9. Success Response (Structured JSON as requested)
    return new Response(JSON.stringify({ 
      jobId: job.id,
      status: job.status
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error: any) {
    console.error(`[document-upload] Error [${requestId}]:`, error);
    
    // Log detailed error to DB if possible (using a new client since auth might have failed)
    try {
      const logClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      
      await logClient.from("au_debug_logs").insert({
        component: "document-upload",
        message: "Fatal upload error",
        details: { 
          requestId, 
          error: error.message, 
          stack: error.stack,
          headers: Object.fromEntries(req.headers as any)
        }
      });
    } catch (logErr) {
      console.error("Failed to write to debug log:", logErr);
    }

    // Always return structured JSON with error message, status 500
    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error",
      details: error.stack
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
