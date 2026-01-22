/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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

  // Verify auth for security (only allow service_role or specific secret)
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  
  const isAuthorized = authHeader === `Bearer ${serviceRoleKey}` || 
                       req.headers.get('X-Cron-Secret') === cronSecret;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ 
      error: "Unauthorized",
      requestId 
    }), {
      status: 401,
      headers: corsHeadersWithJson,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log(`[cleanup] Starting inactive account cleanup [${requestId}]`);

    // 1. Get users to delete before they are removed from au_user_activity
    const { data: usersToDelete, error: fetchError } = await supabase
      .from('au_user_activity')
      .select('user_id')
      .lt('last_active_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());

    if (fetchError) throw fetchError;

    // 2. Call the Postgres function to clean up guest sessions and our internal tables
    const { error: rpcError } = await supabase.rpc('cleanup_inactive_accounts');
    if (rpcError) throw rpcError;

    // 3. Delete from auth.users (requires service_role)
    if (usersToDelete && usersToDelete.length > 0) {
      console.log(`[cleanup] Deleting ${usersToDelete.length} inactive users from auth.users`);
      for (const { user_id } of usersToDelete) {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user_id);
        if (deleteError) {
          console.warn(`[cleanup] Failed to delete user ${user_id}:`, deleteError.message);
        }
      }
    }

    console.log(`[cleanup] Finished inactive account cleanup [${requestId}]`);

    return new Response(JSON.stringify({ 
      ok: true, 
      message: "Cleanup successful",
      requestId 
    }), {
      headers: corsHeadersWithJson,
      status: 200,
    });

  } catch (error: any) {
    console.error(`[cleanup] Error [${requestId}]:`, error);
    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error",
      details: error.stack || String(error),
      requestId
    }), {
      headers: corsHeadersWithJson,
      status: 500,
    });
  }
});
