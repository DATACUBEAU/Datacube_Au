import { firstEnv } from '@/lib/server/supabase-admin';
import type {
  PaymentGateway,
  PaymentInitializeData,
  PaymentInitializeResult,
  PaymentVerifyResult,
} from '@/lib/payments/payment-gateway';

const FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com/v3';

export class FlutterwaveError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function getFlutterwaveSecretKey(): string {
  const key = firstEnv('FLUTTERWAVE_SECRET_KEY');
  if (!key) {
    throw new Error('Missing FLUTTERWAVE_SECRET_KEY.');
  }
  return key;
}

export function getFlutterwaveWebhookHash(): string {
  const hash = firstEnv('FLUTTERWAVE_WEBHOOK_SECRET_HASH', 'FLUTTERWAVE_SECRET_HASH');
  if (!hash) {
    throw new Error('Missing FLUTTERWAVE_WEBHOOK_SECRET_HASH.');
  }
  return hash;
}

export function verifyFlutterwaveWebhookSignature(signature: string | null): boolean {
  if (!signature) return false;
  return signature.trim() === getFlutterwaveWebhookHash();
}

async function flutterwaveRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FLUTTERWAVE_BASE_URL}${path}`, {
    method: init?.method || 'GET',
    headers: {
      Authorization: `Bearer ${getFlutterwaveSecretKey()}`,
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

  const ok = res.ok && String(parsed?.status || '').toLowerCase() === 'success';
  if (!ok) {
    throw new FlutterwaveError(
      res.status,
      String(parsed?.message || res.statusText || 'Flutterwave request failed'),
      parsed
    );
  }

  return parsed as T;
}

function resolvePaymentOptions(channels: Array<'card' | 'bank_transfer'> | undefined): string | undefined {
  if (!channels || channels.length === 0) return undefined;
  const hasCard = channels.includes('card');
  const hasBankTransfer = channels.includes('bank_transfer');
  if (hasCard && hasBankTransfer) return 'card,banktransfer';
  if (hasBankTransfer) return 'banktransfer';
  return 'card';
}

function amountKoboToCurrency(amountKobo: number): string {
  const safeAmount = Number.isFinite(amountKobo) ? amountKobo : 0;
  return (safeAmount / 100).toFixed(2);
}

function normalizeVerifyStatus(statusRaw: unknown): string {
  return String(statusRaw || '').trim().toLowerCase();
}

function isSuccessfulVerifyStatus(status: string): boolean {
  return status === 'successful' || status === 'success' || status === 'completed';
}

function normalizeAmountKobo(data: any): number {
  const value = Number(data?.charged_amount ?? data?.amount ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100));
}

function resolveVerifyPath(referenceOrTransactionId: string): string {
  if (/^\d+$/.test(referenceOrTransactionId)) {
    return `/transactions/${encodeURIComponent(referenceOrTransactionId)}/verify`;
  }
  return `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(referenceOrTransactionId)}`;
}

export const flutterwaveGateway: PaymentGateway = {
  gateway: 'flutterwave',

  async initializePayment(data: PaymentInitializeData): Promise<PaymentInitializeResult> {
    const paymentOptions = resolvePaymentOptions(data.channels);

    const payload: Record<string, unknown> = {
      tx_ref: data.reference,
      amount: amountKoboToCurrency(data.amountKobo),
      currency: data.currency || 'NGN',
      redirect_url: data.callbackUrl,
      customer: { email: data.email },
      meta: data.metadata,
      customizations: {
        title: 'Datacube_AU Subscription',
        description: 'Plan checkout',
      },
    };
    if (paymentOptions) {
      payload.payment_options = paymentOptions;
    }

    const response = await flutterwaveRequest<{
      status: string;
      message: string;
      data?: { link?: string; tx_ref?: string };
    }>('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const authorizationUrl = String(response.data?.link || '').trim();
    if (!authorizationUrl) {
      throw new FlutterwaveError(502, 'Flutterwave did not return a checkout link.', response);
    }

    return {
      authorizationUrl,
      reference: String(response.data?.tx_ref || data.reference),
      raw: response,
    };
  },

  async verifyPayment(referenceOrTransactionId: string): Promise<PaymentVerifyResult> {
    const response = await flutterwaveRequest<{
      status: string;
      message: string;
      data?: any;
    }>(resolveVerifyPath(referenceOrTransactionId));

    const data = response.data || {};
    const status = normalizeVerifyStatus(data.status);

    return {
      gateway: 'flutterwave',
      gatewayTransactionId: data?.id != null ? String(data.id) : null,
      reference: String(data?.tx_ref || referenceOrTransactionId),
      status: status || 'unknown',
      success: isSuccessfulVerifyStatus(status),
      amountKobo: normalizeAmountKobo(data),
      channel: String(data?.payment_type || data?.channel || 'unknown'),
      paidAt: data?.paid_at
        ? String(data.paid_at)
        : data?.created_at
          ? String(data.created_at)
          : null,
      customerEmail: data?.customer?.email ? String(data.customer.email).trim().toLowerCase() : null,
      customerCode: data?.customer?.id != null ? String(data.customer.id) : null,
      authorizationCode: data?.authorization?.mode ? String(data.authorization.mode) : null,
      subscriptionCode: null,
      subscriptionEmailToken: null,
      metadata: data?.meta && typeof data.meta === 'object' ? (data.meta as Record<string, unknown>) : {},
      raw: response,
    };
  },
};
