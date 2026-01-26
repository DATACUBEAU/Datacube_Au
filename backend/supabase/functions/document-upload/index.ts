/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders, validateAuth, requireAnyAuth, emitEvent } from "../_shared/au.ts";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB limit

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  // Initialize corsHeaders with default values in case getCorsHeaders fails
  let corsHeaders = {
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

    const contentType = req.headers.get("content-type") || "";
    let fileName: string | null = null;
    let fileData: Uint8Array | null = null;
    let fileSize: number = 0;
    let guestSessionId: string | null = null;
    let jobId: string | null = null;
    let documentId: string | null = null;
    let parentId: string | null = null;
    let expiresAt: string | null = null;
    let documentType: string = "main_textbook";
    let metadata: any = {};

    // 1. Parse body/formData
    let body: any = {};
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      fileName = formData.get("filename") as string || file?.name;
      guestSessionId = formData.get("guest_session_id") as string;
      jobId = formData.get("job_id") as string;
      documentId = formData.get("document_id") as string;
      parentId = formData.get("parent_id") as string;
      expiresAt = formData.get("expires_at") as string;
      documentType = formData.get("document_type") as string || "main_textbook";
      const metaStr = formData.get("metadata") as string;
      if (metaStr) {
        try { metadata = JSON.parse(metaStr); } catch {}
      }

      if (file) {
        if (file.size > MAX_SIZE) {
           return new Response(JSON.stringify({ 
            error: "Upload failed: File size exceeds 50MB limit"
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 413,
          });
        }
        fileData = new Uint8Array(await file.arrayBuffer());
        fileSize = file.size;
      }
      
      // Map for auth validation
      body = { guestSessionId, userId: guestSessionId };
    } else {
      body = await req.json().catch(() => ({}));
      fileName = body.fileName || body.file_name || body.filename;
      guestSessionId = body.guestSessionId || body.guest_session_id || body.userId;
      documentId = body.documentId || body.document_id;
      parentId = body.parentId || body.parent_id;
      expiresAt = body.expiresAt || body.expires_at;
      documentType = body.documentType || body.document_type || "main_textbook";
      metadata = body.metadata || {};
      fileSize = body.file_size || body.fileSize || 0;

      // Handle raw content if provided
      if (body.content && !fileData) {
        fileData = new TextEncoder().encode(body.content);
        fileSize = fileData.length;
        if (!fileName) fileName = `content-${Date.now()}.txt`;
      }
    }
    
    // Check file size for JSON/Raw uploads
    if (fileSize > MAX_SIZE) {
       return new Response(JSON.stringify({ 
        error: "Upload failed: File size exceeds 50MB limit"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 413,
      });
    }

    // 2. Validate required fields BEFORE DB logic
    if (!fileName && !body.content) {
      return new Response(JSON.stringify({ 
        error: "Missing required field: fileName"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 3. Validate Auth
    const { userId, ownershipFilter, supabaseAdmin: supabase, error: authError } = await requireAnyAuth(req, body);

    if (authError) {
      return new Response(JSON.stringify({ 
        error: authError || "Authentication failed"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const effectiveFilter = ownershipFilter || (guestSessionId ? { guest_session_id: guestSessionId } : {});
    const effectiveUserId = userId || guestSessionId;
    
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

    // 5. Upload to Storage if file data is present
    let filePath = body.filePath || body.file_path || "";
    if (fileData && fileName) {
      const bucket = Deno.env.get("SUPABASE_BUCKET") || Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") || "documents";
      
      // Use deterministic path for overwriting support (upsert: true)
      // Folder structure based on document type
      let folder = "uploads";
      if (documentType === "main_textbook") folder = "textbooks";
      else if (documentType === "supplementary") folder = "supplementary";
      
      // Sanitize filename to prevent issues
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      filePath = `${effectiveUserId}/${folder}/${safeFileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, fileData, {
          contentType: fileName?.endsWith(".pdf") ? "application/pdf" : 
                       fileName?.endsWith(".txt") ? "text/plain" :
                       "application/octet-stream",
          upsert: true,
        });

      if (uploadError) throw uploadError;
    }

    if (!filePath) {
      return new Response(JSON.stringify({ 
        error: "Missing file content"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

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

    // 7. Enqueue Job (Atomic step 2)
    console.log(`[document-upload] Enqueueing job for document ${doc.id}...`);
    const jobData: any = {
      id: jobId || crypto.randomUUID(),
      document_id: doc.id,
      file_name: fileName,
      file_size_bytes: fileSize || (fileData ? fileData.length : 0),
      bucket: Deno.env.get("SUPABASE_BUCKET") || Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") || "documents",
      object_path: filePath,
      status: "queued",
    };
    
    // Add ownership fields explicitly
    const filter = effectiveFilter as any;
    if (filter.user_id) jobData.user_id = filter.user_id;
    if (filter.guest_session_id) jobData.guest_session_id = filter.guest_session_id;

    const { data: job, error: jobError } = await supabase
      .from("au_upload_jobs")
      .insert(jobData)
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
