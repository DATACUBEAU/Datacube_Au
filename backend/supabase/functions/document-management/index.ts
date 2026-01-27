// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders, validateAuth, requireAnyAuth, emitEvent } from "../_shared/au.ts";

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
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // 2. Validate required fields BEFORE DB logic
    if (!action) {
      return new Response(JSON.stringify({ 
        error: "Missing required field: action",
        details: "An action (e.g., 'delete', 'wipe-user', 'migrate-guest') must be provided",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 3. Authenticate
    const { userId, ownershipFilter, supabaseAdmin, error: authError } = await requireAnyAuth(req, body);

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

    const effectiveFilter = ownershipFilter || {};

    // --- Action: wipe-user ---
    if (action === "wipe-user") {
      console.log(`[document-management] Wiping data for user ${userId} [${requestId}]`);
      
      const query = supabaseAdmin.from("au_documents").select("id, file_path");
      if (Object.keys(effectiveFilter).length > 0) query.match(effectiveFilter);

      const { data: userDocs, error: docsError } = await query;
      if (docsError) throw docsError;

      const docIds = (userDocs || []).map((d: any) => d.id);
      const filePaths = (userDocs || []).map((d: any) => d.file_path).filter(Boolean);

      let storageCount = 0;
      if (filePaths.length > 0) {
        const bucket = Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") || "documents";
        const { data: storageData } = await supabaseAdmin.storage.from(bucket).remove(filePaths);
        storageCount = storageData?.length || 0;
      }

      // Deletions (CASCADE handles most things)
      await supabaseAdmin.from("au_documents").delete().in("id", docIds);
      
      const sessionsQuery = supabaseAdmin.from("au_sessions").delete();
      if (Object.keys(effectiveFilter).length > 0) sessionsQuery.match(effectiveFilter);
      await sessionsQuery;

      const usageQuery = supabaseAdmin.from("au_model_usage").delete();
      if (Object.keys(effectiveFilter).length > 0) usageQuery.match(effectiveFilter);
      await usageQuery;

      await supabaseAdmin.from("au_events").delete().eq("user_id", userId);

      return new Response(JSON.stringify({ 
        ok: true, 
        details: `Successfully wiped ${docIds.length} documents, ${storageCount} files.`,
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: migrate-guest ---
    if (action === "migrate-guest") {
      const { guestSessionId } = body;
      if (!guestSessionId) {
        return new Response(JSON.stringify({ 
          error: "Missing guestSessionId",
          details: "A guestSessionId must be provided for migration",
          requestId 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }

      console.log(`[document-management] Migrating data from guest ${guestSessionId} to user ${userId} [${requestId}]`);

      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);

      await supabaseAdmin.from("au_documents").update({ 
        user_id: userId, guest_session_id: null, expires_at: newExpiresAt.toISOString() 
      }).eq("guest_session_id", guestSessionId);

      await supabaseAdmin.from("au_upload_jobs").update({ user_id: userId, guest_session_id: null })
        .eq("guest_session_id", guestSessionId);

      await supabaseAdmin.from("au_sessions").update({ user_id: userId, guest_session_id: null })
        .eq("guest_session_id", guestSessionId);

      await supabaseAdmin.from("au_model_usage").update({ user_id: userId, guest_session_id: null })
        .eq("guest_session_id", guestSessionId);

      await supabaseAdmin.from("au_events").update({ user_id: userId }).eq("guest_session_id", guestSessionId);

      await supabaseAdmin.from("au_guest_sessions").delete().eq("id", guestSessionId);

      return new Response(JSON.stringify({ 
        ok: true, details: "Data migrated successfully", requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: delete ---
    if (action === "delete") {
      const { documentId } = body;
      if (!documentId) {
        return new Response(JSON.stringify({ 
          error: "Missing documentId",
          details: "A documentId must be provided for deletion",
          requestId 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }

      console.log(`[document-management] Deleting document ${documentId} [${requestId}]`);

      // 1. Fetch document and children to get file paths
      const query = supabaseAdmin.from("au_documents").select("id, file_path").eq("id", documentId);
      if (Object.keys(effectiveFilter).length > 0) query.match(effectiveFilter);
      const { data: doc, error: fetchError } = await query.single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          return new Response(JSON.stringify({ ok: true, message: "Document already deleted", requestId }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw fetchError;
      }

      const childrenQuery = supabaseAdmin.from("au_documents").select("id, file_path").eq("parent_id", documentId);
      if (Object.keys(effectiveFilter).length > 0) childrenQuery.match(effectiveFilter);
      const { data: children } = await childrenQuery;

      const docsToDelete = [doc, ...(children || [])];
      const docIds = docsToDelete.map((d: any) => d.id);
      const filePaths = docsToDelete.map((d: any) => d.file_path).filter(Boolean);

      // 2. Remove from Storage
      if (filePaths.length > 0) {
        const bucket = Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") || "documents";
        await supabaseAdmin.storage.from(bucket).remove(filePaths);
      }

      // 3. Database Deletion (CASCADE handles chunks, embeddings, jobs)
      const { error: deleteError } = await supabaseAdmin.from("au_documents").delete().in("id", docIds);
      if (deleteError) throw deleteError;

      // 4. Emit Event
      await emitEvent(supabaseAdmin, {
        event_type: 'document_deleted',
        entity_id: documentId,
        user_id: userId || 'anonymous',
        metadata: { deletedCount: docIds.length, requestId }
      });

      return new Response(JSON.stringify({ ok: true, requestId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ 
      error: "Invalid action",
      details: `Action '${action}' is not supported`,
      requestId 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });

  } catch (error: any) {
    console.error(`[document-management] Error [${requestId}]:`, error);
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
