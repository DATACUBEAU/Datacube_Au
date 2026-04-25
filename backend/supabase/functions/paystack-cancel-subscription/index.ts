import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, corsHeaders, getServiceClient } from "../_shared/au.ts";
import { disablePaystackSubscription } from "../_shared/paystack.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { userId, authError } = await validateAuth(req);
    if (authError || !userId) {
      throw new Error("Unauthorized: " + (authError || "No session"));
    }

    const { reason } = await req.json();
    if (!reason || reason.length < 10) throw new Error("Reason must be at least 10 characters");

    const supabaseAdmin = getServiceClient();

    // 1. Get Active Subscription
    const { data: sub, error } = await supabaseAdmin
        .from('au_subscriptions')
        .select('*')
        .eq('owner_id', userId)
        .in('status', ['active', 'non_renewing']) // Check both to handle race conditions or re-cancels
        .single();

    if (error || !sub) throw new Error("No active subscription found");

    if (sub.status === 'non_renewing') throw new Error("Subscription is already canceled");

    // 2. Disable on Paystack
    // We need the email token which is stored in paystack_email_token
    if (!sub.paystack_email_token) {
         throw new Error("Cannot cancel: Missing email token. Please contact support.");
    }

    await disablePaystackSubscription(sub.paystack_subscription_code, sub.paystack_email_token);

    // 3. Update DB
    await supabaseAdmin.from('au_subscriptions').update({
        status: 'non_renewing',
        canceled_at: new Date().toISOString(),
        cancel_reason: reason,
        cancel_source: 'user'
    }).eq('id', sub.id);

    return new Response(JSON.stringify({ success: true, message: "Subscription canceled. Access remains until end of period." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Cancel Subscription Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
