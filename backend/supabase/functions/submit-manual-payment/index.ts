import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/au.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Invalid Supabase token");

    const { plan, amount, reference } = await req.json();

    if (!plan || !amount || !reference) {
        throw new Error("Missing required fields: plan, amount, reference");
    }

    if (!['weekly', 'monthly'].includes(plan)) {
        throw new Error("Invalid plan type. Must be 'weekly' or 'monthly'.");
    }

    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error("Invalid amount");
    }

    const modernInsert = {
      owner_id: user.id,
      provider: 'manual',
      channel: 'bank_transfer',
      plan,
      amount_ngn: normalizedAmount,
      currency: 'NGN',
      status: 'pending',
      reference,
      reference_code: reference,
      provider_ref: reference,
      metadata: { source: 'manual_transfer' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const legacyInsert = {
      user_id: user.id,
      provider: 'manual',
      plan,
      amount: normalizedAmount,
      currency: 'NGN',
      status: 'pending',
      provider_ref: reference,
      reference_code: reference,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let { error } = await supabaseClient
      .from('au_payments')
      .insert(modernInsert as any);

    if (error) {
      const message = String(error.message || '').toLowerCase();
      const missingColumn =
        message.includes('column') && message.includes('does not exist');

      if (missingColumn) {
        const fallback = await supabaseClient
          .from('au_payments')
          .insert(legacyInsert as any);
        error = fallback.error;
      }
    }

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Manual Payment Submit Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
