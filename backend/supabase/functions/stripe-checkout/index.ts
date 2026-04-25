import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, corsHeaders, getServiceClient } from "../_shared/au.ts";
import { createCheckout } from "../_shared/billing_providers.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { userId, isAdmin, authError } = await validateAuth(req);
    if (authError || !userId) {
      throw new Error("Unauthorized: " + (authError || "No session"));
    }

    const { planType, redirectUrls } = await req.json(); // expect redirectUrls object { success, cancel }

    const supabaseAdmin = getServiceClient();
    const { data: config, error: configError } = await supabaseAdmin
      .from('au_conex_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (configError) {
      throw new Error(`Failed to read Conex billing config: ${configError.message}`);
    }
    
    const billingEnabled = config?.billing_enabled === true;
    if (!billingEnabled && !isAdmin) {
        throw new Error("Billing is currently disabled.");
    }

    const stripePriceWeeklyId =
      (typeof config?.stripe_price_weekly === 'string' && config.stripe_price_weekly.trim()) ||
      (typeof config?.stripe_price_weekly_id === 'string' && config.stripe_price_weekly_id.trim()) ||
      '';
    const stripePriceMonthlyId =
      (typeof config?.stripe_price_monthly === 'string' && config.stripe_price_monthly.trim()) ||
      (typeof config?.stripe_price_monthly_id === 'string' && config.stripe_price_monthly_id.trim()) ||
      '';

    if (planType === 'weekly' && !stripePriceWeeklyId) {
      throw new Error('Stripe weekly price ID is not configured in Conex billing settings.');
    }
    if (planType === 'monthly' && !stripePriceMonthlyId) {
      throw new Error('Stripe monthly price ID is not configured in Conex billing settings.');
    }

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (!email) throw new Error("User email not found");

    const result = await createCheckout(
        'stripe',
        planType, // 'weekly' or 'monthly'
        userId,
        email,
        {
            stripe_price_weekly: stripePriceWeeklyId,
            stripe_price_monthly: stripePriceMonthlyId
        },
        redirectUrls || { 
            success: `${Deno.env.get("STRIPE_SUCCESS_URL") ?? "http://localhost:3000/dashboard/settings"}`,
            cancel: `${Deno.env.get("STRIPE_CANCEL_URL") ?? "http://localhost:3000/dashboard/settings"}`
        }
    );

    return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
