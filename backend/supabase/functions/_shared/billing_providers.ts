
import { stripe } from "./stripe.ts";
import { initiatePaystackTransaction, PAYSTACK_SECRET_KEY } from "./paystack.ts";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";
import { getPlanCode } from "./billing_config.ts";

export interface BillingConfig {
  stripe_price_weekly?: string;
  stripe_price_monthly?: string;
  stripe_price_weekly_id?: string;
  stripe_price_monthly_id?: string;
  paystack_amount_weekly?: number;
  paystack_amount_monthly?: number;
}

export async function createCheckout(
  provider: 'stripe' | 'paystack',
  plan: 'weekly' | 'monthly',
  userId: string,
  email: string,
  config: BillingConfig,
  redirectUrls: { success: string; cancel: string },
  options?: { channels?: string[], mode?: 'subscription' | 'one_time' }
) {
  if (provider === 'stripe') {
    const priceId = plan === 'weekly'
      ? (config.stripe_price_weekly || config.stripe_price_weekly_id)
      : (config.stripe_price_monthly || config.stripe_price_monthly_id);
    if (!priceId) throw new Error(`Stripe price not configured for ${plan} plan`);

    // 1. Search/Create Customer
    let customerId: string | undefined;
    const existing = await stripe.customers.search({ query: `metadata['au_user_id']:'${userId}'`, limit: 1 });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const c = await stripe.customers.create({ email, metadata: { au_user_id: userId } });
      customerId = c.id;
    }

    // 2. Create Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${redirectUrls.success}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: redirectUrls.cancel,
      client_reference_id: userId,
      metadata: { au_user_id: userId, tier: 'pro', plan_type: plan },
      allow_promotion_codes: true,
    });

    return { url: session.url, id: session.id, provider: 'stripe' };

  } else if (provider === 'paystack') {
    const amount = plan === 'weekly' ? config.paystack_amount_weekly : config.paystack_amount_monthly;
    if (!amount) throw new Error(`Paystack amount not configured for ${plan} plan`);
    
    // Paystack expects amount in kobo (NGN * 100)
    const amountInKobo = Math.round(Number(amount) * 100);

    let paystackPlanCode: string | undefined;
    if (options?.mode === 'subscription') {
        // Fetch plan code from config OR Env
        if (plan === 'weekly') {
            paystackPlanCode = config.paystack_plan_weekly || getPlanCode('weekly');
        } else if (plan === 'monthly') {
            paystackPlanCode = config.paystack_plan_monthly || getPlanCode('monthly');
        }

        if (!paystackPlanCode) {
            console.warn(`[Paystack] Subscription mode requested but no plan code found for ${plan}. Falling back to one-time payment.`);
        }
    }

    const res = await initiatePaystackTransaction(email, amountInKobo, redirectUrls.success, {
      au_user_id: userId,
      tier: 'pro',
      plan_type: plan,
      mode: options?.mode || 'one_time',
      custom_fields: [{ display_name: "Plan", variable_name: "plan", value: plan }]
    }, options?.channels, paystackPlanCode);

    return { url: res.data.authorization_url, reference: res.data.reference, provider: 'paystack' };
  }

  throw new Error(`Unknown provider: ${provider}`);
}

export async function verifyWebhook(provider: 'stripe' | 'paystack', req: Request, rawBody: string): Promise<any> {
  if (provider === 'stripe') {
    const sig = req.headers.get("stripe-signature");
    if (!sig) throw new Error("Missing stripe-signature");
    return await stripe.webhooks.constructEventAsync(rawBody, sig, Deno.env.get("STRIPE_WEBHOOK_SECRET")!);
  } 
  
  if (provider === 'paystack') {
    const sig = req.headers.get("x-paystack-signature");
    if (!sig) throw new Error("Missing x-paystack-signature");
    
    const hash = createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');
      
    if (hash !== sig) throw new Error("Invalid Paystack signature");
    
    return JSON.parse(rawBody);
  }

  throw new Error("Unknown provider");
}

// Unified Ledger & Profile Update Logic
export async function extendProTier(supabaseAdmin: any, userId: string, durationDays: number) {
    const now = new Date();
    let expiresAt = new Date(now);

    // Check existing expiry
    const { data: profile } = await supabaseAdmin
        .from('au_user_profiles')
        .select('tier_expires_at')
        .eq('user_id', userId)
        .single();

    if (profile && profile.tier_expires_at) {
        const currentExpiry = new Date(profile.tier_expires_at);
        // If current expiry is in future, add to it. If past, add to NOW.
        if (currentExpiry > now) {
            expiresAt = new Date(currentExpiry.getTime() + (durationDays * 24 * 60 * 60 * 1000));
        } else {
            expiresAt.setDate(now.getDate() + durationDays);
        }
    } else {
        expiresAt.setDate(now.getDate() + durationDays);
    }

    // Update Profile
    await supabaseAdmin.from('au_user_profiles').update({
        tier: 'pro',
        tier_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
    }).eq('user_id', userId);

    return expiresAt;
}

export async function handleWebhookEvent(
  provider: 'stripe' | 'paystack',
  event: any,
  supabaseAdmin: any
) {
  // 1. Idempotency Check
  const eventId = provider === 'stripe' ? event.id : event.event; // Paystack doesn't have a unique 'id' for the event wrapper usually, but 'data.reference' is unique for charge.success
  // For Paystack, we might use data.reference + event type as unique key? 
  // Actually Paystack events have an 'id' field too? Let's check docs or assume reference for charge events.
  // Wait, Paystack events DO NOT guarantee a unique event ID in the top level.
  // We should use `event.data.reference` for charge.success. For others, maybe generate a hash?
  
  let uniqueEventId = '';
  let eventType = '';

  if (provider === 'stripe') {
    uniqueEventId = event.id;
    eventType = event.type;
  } else {
    eventType = event.event;
    // For paystack charge.success, reference is unique.
    if (event.data && event.data.reference) {
        uniqueEventId = `${eventType}_${event.data.reference}`;
    } else {
        // Fallback for non-transaction events
        uniqueEventId = `${eventType}_${Date.now()}`; 
    }
  }

  // Idempotency: Insert into au_billing_events
  const { error: conflictError } = await supabaseAdmin
    .from('au_billing_events')
    .insert({
        provider,
        event_id: uniqueEventId,
        type: eventType
    });

  if (conflictError) {
      // If conflict (duplicate), we assume it's processed.
      console.log(`[${provider}] Event ${uniqueEventId} already processed.`);
      return { processed: false, reason: 'duplicate' };
  }

  // 2. Process Event
  if (provider === 'stripe') {
      await handleStripeEvent(event, supabaseAdmin);
  } else if (provider === 'paystack') {
      await handlePaystackEvent(event, supabaseAdmin);
  }

  return { processed: true };
}

async function handleStripeEvent(event: any, supabaseAdmin: any) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.au_user_id;
    if (!userId) return;

    // Retrieve subscription details
    const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
    const priceId = subscription.items.data[0].price.id;
    const amount = session.amount_total ? session.amount_total / 100 : 0; // Stripe is in cents
    const currency = session.currency?.toUpperCase() || 'NGN';
    const planType = session.metadata?.plan_type || 'unknown';

    // Update Profile
    await supabaseAdmin.from('au_user_profiles').update({
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        stripe_price_id: priceId,
        stripe_status: subscription.status,
        stripe_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        tier: 'pro',
        tier_expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
        billing_source: 'stripe'
    }).eq('user_id', userId);

    // Record Payment
    await supabaseAdmin.from('au_payments').insert({
        user_id: userId,
        provider: 'stripe',
        plan: planType,
        amount: amount,
        currency: currency,
        status: 'succeeded',
        provider_ref: session.invoice || session.id, // Invoice ID preferred
        metadata: session.metadata
    });

  } else if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object;
      const status = sub.status; // active, past_due, unpaid, canceled, incomplete, incomplete_expired
      
      // Find user
      const { data: profile } = await supabaseAdmin
        .from('au_user_profiles')
        .select('user_id, tier')
        .eq('stripe_customer_id', sub.customer)
        .single();
      
      if (profile) {
          let newTier = profile.tier;
          let expiry = new Date(sub.current_period_end * 1000).toISOString();

          // Downgrade logic
          if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
              newTier = 'free';
          }
          
          await supabaseAdmin.from('au_user_profiles').update({
              stripe_subscription_id: sub.id,
              stripe_status: status,
              stripe_current_period_end: expiry,
              tier: newTier,
              // If pro, set expiry. If free, do NOT clear expiry if it was set by Paystack? 
              // But Stripe is taking over?
              // Let's assume strict Stripe control if Stripe event.
              tier_expires_at: newTier === 'pro' ? expiry : null, 
          }).eq('user_id', profile.user_id);
      }
  }
}

async function handlePaystackEvent(event: any, supabaseAdmin: any) {
  const data = event.data;
  
  // 1. Handle Charge Success (Payments)
  if (event.event === 'charge.success') {
      const metadata = data.metadata || {};
      const userId = metadata.au_user_id; // Metadata is preserved for recurring charges
      const planType = metadata.plan_type || 'unknown'; // 'weekly' or 'monthly'
      
      if (!userId) {
          console.warn("[Paystack] charge.success missing userId in metadata", data.reference);
          return;
      }

      const amount = data.amount / 100;
      const currency = data.currency || 'NGN';
      const reference = data.reference;
      
      // Determine duration
      let durationDays = 7;
      if (planType === 'monthly' || (data.plan && data.plan.interval === 'monthly')) {
          durationDays = 30;
      } else if (planType === 'weekly' || (data.plan && data.plan.interval === 'weekly')) {
          durationDays = 7;
      }

      // Extend Tier
      await extendProTier(supabaseAdmin, userId, durationDays);

      // Update specific Paystack fields
      await supabaseAdmin.from('au_user_profiles').update({
          billing_source: 'paystack',
          paystack_customer_code: data.customer?.customer_code,
          paystack_auth_code: data.authorization?.authorization_code,
      }).eq('user_id', userId);

      // Record Payment
      const paymentData = {
          owner_id: userId,
          provider: 'paystack',
          plan: planType !== 'unknown' ? planType : (durationDays === 30 ? 'monthly' : 'weekly'),
          amount_ngn: amount,
          currency: currency,
          status: 'success',
          reference: reference,
          channel: data.channel,
          paystack_tx_id: String(data.id),
          last_webhook_event_id: event.data.id ? String(event.data.id) : null,
          confirmed_at: new Date().toISOString(),
          metadata: metadata
      };

      await supabaseAdmin.from('au_payments').upsert(paymentData, { onConflict: 'reference' });
  }

  // 2. Handle Subscription Created
   if (event.event === 'subscription.create') {
       const customerCode = data.customer.customer_code;
       const subscriptionCode = data.subscription_code;
       const emailToken = data.email_token;
       const email = data.customer.email;
       
       // Find owner by customer code OR email
       let { data: profile } = await supabaseAdmin
         .from('au_user_profiles')
         .select('user_id')
         .eq('paystack_customer_code', customerCode)
         .maybeSingle();
       
       if (!profile && email) {
           // Fallback: Find by email in Auth (if accessible) or trust the email if unique in system
           // Since we can't easily query auth.users from here without admin privileges on auth schema which we might have
           // Try to find via a join or helper if possible? 
           // Actually, we can assume the user MUST have existed to initiate payment.
           // We can try to match email if we had it in profiles, but profiles don't usually have email.
           // However, paystack-initiate ensures email is correct.
           
           // If we can't find by customer_code, it means charge.success hasn't updated the profile yet.
           // We can try to look up the payment we just initiated?
           // The 'initiated' payment has owner_id. But it doesn't have customer_code yet.
           // But it has email? No, au_payments doesn't store email.
           
           // We can rely on Retries. Paystack retries webhooks.
           // If we fail here, we return 400 or 500, Paystack retries.
           // By then charge.success should have processed.
           
           // BUT, let's try to be robust.
           // If we have `getServiceClient`, we can search `auth.users`?
           const { data: user } = await supabaseAdmin.auth.admin.listUsers();
           // listUsers is slow/bad for scale.
           
           // Let's just return error to force retry if profile not found.
           if (!profile) {
               console.warn(`[Paystack] subscription.create: User not found for code ${customerCode}. Throwing error to trigger retry.`);
               throw new Error("User profile not linked yet. Retry later.");
           }
       }
         
       if (profile) {
          const planInterval = data.plan.interval; // 'weekly', 'monthly'
          
          await supabaseAdmin.from('au_subscriptions').upsert({
              owner_id: profile.user_id,
              provider: 'paystack',
              plan_interval: planInterval,
              status: 'active',
              paystack_subscription_code: subscriptionCode,
              paystack_email_token: emailToken,
              paystack_customer_code: customerCode,
              current_period_start: data.createdAt, // or data.start_date
              current_period_end: data.next_payment_date,
              started_at: new Date().toISOString()
          }, { onConflict: 'paystack_subscription_code' });
      } else {
          console.warn(`[Paystack] subscription.create: No user found for customer code ${customerCode}`);
      }
  }

  // 3. Handle Subscription Disabled
  if (event.event === 'subscription.disable') {
      const subscriptionCode = data.subscription_code;
      
      await supabaseAdmin.from('au_subscriptions').update({
          status: 'non_renewing',
          canceled_at: new Date().toISOString(),
          cancel_source: 'system' // Default to system if webhook triggers it
      }).eq('paystack_subscription_code', subscriptionCode);
  }
}
