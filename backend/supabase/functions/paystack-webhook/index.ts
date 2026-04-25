
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceClient } from "../_shared/au.ts";
import { verifyWebhook, handleWebhookEvent } from "../_shared/billing_providers.ts";

serve(async (req) => {
  try {
    const rawBody = await req.text();
    const event = await verifyWebhook('paystack', req, rawBody);
    
    const supabaseAdmin = getServiceClient();
    
    const result = await handleWebhookEvent('paystack', event, supabaseAdmin);
    
    return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
      console.error("Paystack Webhook processing error:", err);
      
      // Log security event
      try {
        const supabaseAdmin = getServiceClient();
        await supabaseAdmin.from("au_security_events").insert([{
            event_type: 'webhook_fail',
            severity: 'warning',
            ip_address: req.headers.get("x-forwarded-for") || "unknown",
            metadata: { error: err.message, provider: 'paystack' }
        }]);
      } catch (logErr) {
        console.error("Failed to log security event:", logErr);
      }

      return new Response(`Server Error: ${err.message}`, { status: 400 });
  }
});
