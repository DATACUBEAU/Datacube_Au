import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, requireUser } from "../_shared/au.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    
    // Auth Check using Shared Helper
    const auth = await requireUser(req, body);
    const { userId, supabaseAdmin } = auth;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { action, documentId } = body;

    if (action === "delete" && documentId) {
        console.log(`[document-management] Deleting document ${documentId}`);

        // 1. Verify Ownership (Strict)
        const { data: doc, error: fetchError } = await supabaseAdmin
            .from("au_documents")
            .select("id, file_path")
            .eq("id", documentId)
            .eq("owner_id", userId)
            .single();
        
        if (fetchError || !doc) {
            return new Response(JSON.stringify({ error: "Document not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 2. Delete from Storage
        if (doc.file_path) {
            const bucket = Deno.env.get("BUCKET") || "documents";
            const { error: storageError } = await supabaseAdmin.storage
                .from(bucket)
                .remove([doc.file_path]);
            
            if (storageError) console.warn("Storage deletion failed:", storageError);
        }

        // 3. Delete from DB (Cascades to chunks)
        const { error: deleteError } = await supabaseAdmin
            .from("au_documents")
            .delete()
            .eq("id", documentId);
        
        if (deleteError) throw deleteError;

        // 4. Log Event
        await supabaseAdmin.from("au_events").insert({
            event_type: "document_deleted",
            entity_id: documentId,
            user_id: userId,
            metadata: { file_path: doc.file_path }
        });

        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_signed_url" && documentId) {
        // 1. Verify Ownership
        const { data: doc, error: fetchError } = await supabaseAdmin
            .from("au_documents")
            .select("id, file_path")
            .eq("id", documentId)
            .eq("owner_id", userId)
            .single();

        if (fetchError || !doc) {
            return new Response(JSON.stringify({ error: "Document not found or access denied" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (!doc.file_path) {
             return new Response(JSON.stringify({ error: "No file path associated" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 2. Generate Signed URL
        const bucket = Deno.env.get("BUCKET") || "documents";
        const { data, error } = await supabaseAdmin
            .storage
            .from(bucket)
            .createSignedUrl(doc.file_path, 60 * 60); // 1 hour

        if (error) throw error;

        return new Response(JSON.stringify({ ok: true, signedUrl: data.signedUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "wipe-user") {
        console.log(`[document-management] Wiping user data for ${userId}`);
        
        // 1. Delete all documents (Storage + DB)
        const { data: docs } = await supabaseAdmin
            .from("au_documents")
            .select("id, file_path")
            .eq("owner_id", userId);
        
        if (docs && docs.length > 0) {
            const bucket = Deno.env.get("BUCKET") || "documents";
            const paths = docs.map((d: any) => d.file_path).filter(Boolean);
            
            if (paths.length > 0) {
                await supabaseAdmin.storage.from(bucket).remove(paths);
            }
            
            // Delete from DB (Cascades to chunks/embeddings usually, but we force it)
            await supabaseAdmin.from("au_documents").delete().eq("owner_id", userId);
        }

        // 2. Delete Chat History
        await supabaseAdmin.from("au_messages").delete().eq("user_id", userId);
        await supabaseAdmin.from("au_sessions").delete().eq("user_id", userId);
        
        // 3. Delete Activity/Logs
        await supabaseAdmin.from("au_user_activity").delete().eq("user_id", userId);
        await supabaseAdmin.from("au_debug_logs").delete().eq("user_id", userId); // If column exists

        // 4. Trigger Vector Deletion (Qdrant)
        // Since we don't have direct Qdrant access here, we rely on the deletion log or a separate worker trigger.
        // We insert into a deletion log that the worker polls.
        if (docs && docs.length > 0) {
            const deletionLogs = docs.map((d: any) => ({
                document_id: d.id,
                file_path: d.file_path, // Optional, for double check
                processed: false
            }));
            await supabaseAdmin.from("au_deletion_log").insert(deletionLogs);
        }

        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("Management Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
