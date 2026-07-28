import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { firstEnv } from '@/lib/server/env';
import {
  assertBillingGatewayCapability,
  BillingConfigurationError,
  type BillingConfigAction,
} from '@/lib/server/billing-config';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export class PaystackError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function getPaystackSecretKey(action: BillingConfigAction = 'checkout_initialize'): string {
  assertBillingGatewayCapability({ gateway: 'paystack', action });
  const key = firstEnv('PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET');
  if (!key) {
    throw new BillingConfigurationError({
      gateway: 'paystack',
      action,
      missingEnv: ['PAYSTACK_SECRET_KEY'],
    });
  }
  return key;
}

export function verifyPaystackWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha512', getPaystackSecretKey('webhook')).update(rawBody).digest('hex');
  const normalizedSignature = signature.trim().toLowerCase();
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(normalizedSignature, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

async function paystackRequest<T>(
  path: string,
  init?: RequestInit,
  action: BillingConfigAction = 'checkout_initialize',
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method: init?.method || 'GET',
    headers: {
      Authorization: `Bearer ${getPaystackSecretKey(action)}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    body: init?.body,
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text };
  }

  if (!res.ok || parsed?.status === false) {
    throw new PaystackError(
      res.status,
      String(parsed?.message || res.statusText || 'Paystack request failed'),
      parsed
    );
  }

  return parsed as T;
}

export type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

export async function initializePaystackTransaction(input: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  channels: Array<'card' | 'bank_transfer'>;
  planCode?: string | null;
  metadata: Record<string, unknown>;
}): Promise<PaystackInitializeResponse> {
  const payload: Record<string, unknown> = {
    email: input.email,
    amount: input.amountKobo,
    reference: input.reference,
    callback_url: input.callbackUrl,
    channels: input.channels,
    metadata: input.metadata,
  };
  if (input.planCode) {
    payload.plan = input.planCode;
  }

  return paystackRequest<PaystackInitializeResponse>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 'checkout_initialize');
}

export type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: string;
    reference: string;
    amount: number;
    channel: string;
    paid_at: string | null;
    customer?: {
      email?: string;
      customer_code?: string;
    };
    authorization?: {
      authorization_code?: string;
    };
    subscription?: string | null;
    metadata?: Record<string, unknown> | null;
  };
};

export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifyResponse> {
  return paystackRequest<PaystackVerifyResponse>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    undefined,
    'payment_verify',
  );
}

export async function disablePaystackSubscription(input: {
  code: string;
  token: string;
}): Promise<{ status: boolean; message: string; data: Record<string, unknown> }> {
  return paystackRequest('/subscription/disable', {
    method: 'POST',
    body: JSON.stringify({
      code: input.code,
      token: input.token,
    }),
  }, 'subscription_cancel');
}

export async function enablePaystackSubscription(input: {
  code: string;
  token: string;
}): Promise<{ status: boolean; message: string; data: Record<string, unknown> }> {
  return paystackRequest('/subscription/enable', {
    method: 'POST',
    body: JSON.stringify({
      code: input.code,
      token: input.token,
    }),
  }, 'subscription_cancel');
}
