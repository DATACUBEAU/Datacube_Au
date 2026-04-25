import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceClient } from "../_shared/au.ts";
import { verifyWebhook, handleWebhookEvent } from "../_shared/billing_providers.ts";

serve(async (req) => {
  try {
    const rawBody = await req.text();
    const event = await verifyWebhook('stripe', req, rawBody);
    
    const supabaseAdmin = getServiceClient();
    
    const result = await handleWebhookEvent('stripe', event, supabaseAdmin);
    
    return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
      console.error("Webhook processing error:", err);
      return new Response(`Server Error: ${err.message}`, { status: 400 }); // 400 so Stripe retries if it's transient? No, 400 usually means bad request. 500 for retry.
      // But verifyWebhook throws if signature fails (400).
      // Let's stick to 400 for signature issues.
  }
});

