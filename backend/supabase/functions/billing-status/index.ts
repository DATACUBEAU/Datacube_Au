
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, corsHeaders, getServiceClient } from "../_shared/au.ts";
import { PRICING_CONFIG } from "../_shared/billing_config.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { userId, authError } = await validateAuth(req);
    if (authError || !userId) {
      throw new Error("Unauthorized: " + (authError || "No session"));
    }

    const supabaseAdmin = getServiceClient();

    // 1. Get Profile Info
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('au_user_profiles')
        .select('tier, tier_expires_at')
        .eq('user_id', userId)
        .single();

    if (profileError) throw new Error("Failed to fetch profile");

    // 2. Get Active Subscription
    const { data: subscription } = await supabaseAdmin
        .from('au_subscriptions')
        .select('status, plan_interval, current_period_end, cancel_reason')
        .eq('owner_id', userId)
        .in('status', ['active', 'non_renewing'])
        .maybeSingle();

    // 3. Get Payment History (Last 10) with legacy column fallback.
    let payments: any[] | null = null;
    {
      const ownerQuery = await supabaseAdmin
        .from('au_payments')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!ownerQuery.error) {
        payments = ownerQuery.data || [];
      } else {
        const missingOwnerColumn = String(ownerQuery.error.message || '').toLowerCase().includes('owner_id');
        if (missingOwnerColumn) {
          const legacyQuery = await supabaseAdmin
            .from('au_payments')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);
          if (!legacyQuery.error) {
            payments = legacyQuery.data || [];
          }
        }
      }
    }

    const [{ data: conexConfig }, { data: legacyConfig }] = await Promise.all([
      supabaseAdmin
        .from('au_conex_config')
        .select('billing_enabled')
        .eq('id', 1)
        .maybeSingle(),
      supabaseAdmin
        .from('au_config')
        .select('billing_enabled')
        .limit(1)
        .maybeSingle(),
    ]);

    const billingEnabled = conexConfig?.billing_enabled ?? legacyConfig?.billing_enabled ?? true;

    const result = {
        tier: profile.tier,
        tier_expires_at: profile.tier_expires_at,
        billingEnabled,
        subscription: subscription ? {
            status: subscription.status,
            interval: subscription.plan_interval,
            renews_at: subscription.current_period_end,
            cancel_reason: subscription.cancel_reason
        } : null,
        payments: payments || [],
        pricing: PRICING_CONFIG
    };

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
