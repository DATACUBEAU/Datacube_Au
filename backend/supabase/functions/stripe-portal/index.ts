import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, corsHeaders, getServiceClient } from "../_shared/au.ts";
import { stripe } from "../_shared/stripe.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId, authError } = await validateAuth(req);
    if (authError || !userId) {
      throw new Error("Unauthorized");
    }

    const supabaseAdmin = getServiceClient();
    const { data: profile } = await supabaseAdmin
        .from('au_user_profiles')
        .select('stripe_customer_id')
        .eq('user_id', userId)
        .single();

    if (!profile?.stripe_customer_id) {
        throw new Error("No billing profile found.");
    }

    const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: Deno.env.get("STRIPE_SUCCESS_URL") ?? "http://localhost:3000/dashboard/settings",
    });

    return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
