import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { deletePoints } from "../_shared/qdrant.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const RETRY_COUNT = Math.max(1, Number(Deno.env.get("RETENTION_CLEANUP_RETRIES") || 3));
const RETRY_BASE_MS = Math.max(300, Number(Deno.env.get("RETENTION_CLEANUP_RETRY_BASE_MS") || 800));

async function wait(ms: number): Promise<void> {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRetentionCleanupWithRetry() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for retention cleanup");
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let lastError: any = null;
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    const { data, error } = await supabaseAdmin.rpc("cleanup_retention_data", {
      p_dry_run: false,
    });

    if (!error) {
      console.log("[maintenance-cron] Retention cleanup complete", {
        attempt,
        result: data || null,
      });
      return data;
    }

    lastError = error;
    if (attempt >= RETRY_COUNT) {
      break;
    }
    const backoffMs = Math.min(RETRY_BASE_MS * (2 ** (attempt - 1)), 8000);
    console.warn("[maintenance-cron] Retention cleanup failed; retrying", {
      attempt,
      backoffMs,
      message: error.message || String(error),
    });
    await wait(backoffMs);
  }

  throw lastError;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const retentionResult = await runRetentionCleanupWithRetry();

    const now = Math.floor(Date.now() / 1000);
    console.log(`Running maintenance for Qdrant. Deleting vectors with expires_at < ${now}`);

    const result = await deletePoints({
        must: [
          {
            key: "expires_at",
            range: {
              lt: now
            }
          }
        ]
    });

    return new Response(
      JSON.stringify({
        message: "Maintenance complete",
        retention: retentionResult || null,
        qdrant: result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
