
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, corsHeaders, getServiceClient } from "../_shared/au.ts";
import { createCheckout } from "../_shared/billing_providers.ts";
import { PRICING_CONFIG, getPlanCode } from "../_shared/billing_config.ts";

serve(async (req) => {
  // CORS Preflight - Handle OPTIONS explicitly
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { userId, isAdmin, authError } = await validateAuth(req);
    if (authError || !userId) {
      throw new Error("Unauthorized: " + (authError || "No session"));
    }

    const { planType, redirectUrls, channels, mode } = await req.json();

    const supabaseAdmin = getServiceClient();
    const { data: configData, error: configError } = await supabaseAdmin
      .from('au_conex_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (configError) {
      throw new Error(`Failed to read Conex billing config: ${configError.message}`);
    }
    
    // Default config if missing (billing toggle only)
    const billingEnabled = configData ? configData.billing_enabled : true;

    if (!billingEnabled && !isAdmin) {
        throw new Error("Billing is currently disabled.");
    }

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (!email) throw new Error("User email not found");

    // Fetch Plan Codes from Env (Preferred) or DB (Legacy)
    const weeklyPlan = getPlanCode('weekly');
    const monthlyPlan = getPlanCode('monthly');

    const resolvedChannels = (mode === 'subscription') ? ['card'] : (channels || ["card", "bank_transfer"]);

    const result = await createCheckout(
        'paystack',
        planType,
        userId,
        email,
        {
            paystack_amount_weekly: PRICING_CONFIG.weekly.amount,
            paystack_amount_monthly: PRICING_CONFIG.monthly.amount,
            paystack_plan_weekly: weeklyPlan,
            paystack_plan_monthly: monthlyPlan
        },
        redirectUrls || {
            success: `${Deno.env.get("PAYSTACK_SUCCESS_URL") ?? "http://localhost:3000/dashboard/settings"}`,
            cancel: `${Deno.env.get("PAYSTACK_CANCEL_URL") ?? "http://localhost:3000/dashboard/settings"}`
        },
        { channels: resolvedChannels, mode: mode || 'one_time' }
    );

    // Create 'initiated' payment record
    if (result.provider === 'paystack' && result.reference) {
        await supabaseAdmin.from('au_payments').insert({
            owner_id: userId,
            plan: planType,
            amount_ngn: planType === 'weekly' ? PRICING_CONFIG.weekly.amount : PRICING_CONFIG.monthly.amount,
            reference: result.reference,
            channel: resolvedChannels[0], // Default primary channel
            status: 'initiated',
            provider: 'paystack'
        });
    }

    return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Paystack Initiate Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
