
const APP_ENV = Deno.env.get("APP_ENV") ?? "development";
const IS_PRODUCTION = APP_ENV === "production";

// Strict Environment Routing for Paystack Keys
const LIVE_KEY = Deno.env.get("PAYSTACK_SECRET_KEY_LIVE");
const TEST_KEY = Deno.env.get("PAYSTACK_SECRET_KEY_TEST") ?? Deno.env.get("PAYSTACK_SECRET_KEY");

export const PAYSTACK_SECRET_KEY = (IS_PRODUCTION && LIVE_KEY) ? LIVE_KEY : (TEST_KEY ?? "");

if (!PAYSTACK_SECRET_KEY) {
    console.warn(`[Paystack] Warning: No secret key found for environment: ${APP_ENV}`);
} else {
    console.log(`[Paystack] Initialized in ${APP_ENV} mode using ${IS_PRODUCTION ? "LIVE" : "TEST"} key.`);
}

export async function initiatePaystackTransaction(email: string, amountInKobo: number, callbackUrl: string, metadata: any, channels?: string[], plan?: string) {
  const body: any = {
      email,
      amount: amountInKobo,
      callback_url: callbackUrl,
      metadata,
      channels: channels && channels.length > 0 ? channels : ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
  };

  if (plan) {
      body.plan = plan;
  }

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Paystack init failed: ${error}`);
  }

  return await res.json();
}

export async function verifyPaystackTransaction(reference: string) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error("Paystack verification failed");
  }

  return await res.json();
}

export async function disablePaystackSubscription(code: string, token: string) {
  const res = await fetch("https://api.paystack.co/subscription/disable", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code, token }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to disable subscription: ${error}`);
  }

  return await res.json();
}
