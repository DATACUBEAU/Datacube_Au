import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, corsHeaders, getServiceClient } from "../_shared/au.ts";
import { verifyPaystackTransaction } from "../_shared/paystack.ts";
import { extendProTier } from "../_shared/billing_providers.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const reference = url.searchParams.get('reference');

    if (!reference) {
      throw new Error("Missing reference");
    }

    // Verify with Paystack
    const verifyData = await verifyPaystackTransaction(reference);
    const data = verifyData.data;

    if (data.status === 'success') {
      const supabaseAdmin = getServiceClient();
      
      // Update Payment Record
      const metadata = data.metadata || {};
      const userId = metadata.au_user_id; // Important: Metadata MUST have this
      const planType = metadata.plan_type;

      if (userId) {
          // Determine duration
          let durationDays = 7;
          if (planType === 'monthly') durationDays = 30;
          else if (planType === 'weekly') durationDays = 7;

          // Extend Tier using shared logic
          await extendProTier(supabaseAdmin, userId, durationDays);

          await supabaseAdmin.from('au_user_profiles').update({
              billing_source: 'paystack',
              paystack_customer_code: data.customer?.customer_code,
              paystack_auth_code: data.authorization?.authorization_code,
          }).eq('user_id', userId);

          // Update Payment Status
          await supabaseAdmin.from('au_payments').upsert({
              owner_id: userId,
              reference: reference,
              status: 'success',
              amount_ngn: data.amount / 100,
              channel: data.channel,
              plan: planType,
              confirmed_at: new Date().toISOString(),
              paystack_tx_id: String(data.id),
              provider: 'paystack'
          }, { onConflict: 'reference' });
      }
    }

    return new Response(JSON.stringify({ status: data.status, message: data.gateway_response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
