import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/au.ts";

type EffectiveLimitsResult = {
  plan?: string;
  limits?: Record<string, unknown>;
  usage?: {
    day?: string;
    today?: Record<string, number>;
    total?: Record<string, number>;
    reset_at?: string;
  };
  reset_at?: string;
};

function normalizeFlagConfig(value: any): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  let corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  try {
    corsHeaders = getCorsHeaders(req);
  } catch {
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user?.id) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: limitsData, error: limitsError } = await supabaseAdmin.rpc("get_effective_limits", {
      p_user_id: user.id,
    });
    if (limitsError) throw limitsError;

    const result = (limitsData || {}) as EffectiveLimitsResult;

    const { data: flagsData } = await supabaseAdmin
      .from("feature_flags")
      .select("key,enabled,config")
      .in("key", [
        "limits.alerts.enabled",
        "limits.alerts.thresholds",
        "limits.alerts.cooldown_minutes",
        "limits.enforcement.enabled",
        "limits.ui.upsell.enabled",
      ]);

    const flags = (flagsData || []).reduce((acc: Record<string, any>, row: any) => {
      const key = String(row?.key || "").trim();
      if (!key) return acc;
      acc[key] = {
        enabled: row?.enabled === true,
        config: normalizeFlagConfig(row?.config),
      };
      return acc;
    }, {});

    return new Response(JSON.stringify({
      ok: true,
      plan: result.plan || "free",
      limits: result.limits || {},
      usage: result.usage || { today: {}, total: {} },
      reset_at: result.reset_at || result.usage?.reset_at || null,
      flags,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("[usage-status] Error:", error);
    return new Response(JSON.stringify({ message: error?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
