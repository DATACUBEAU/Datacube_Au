import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from '@/lib/server/paystack';
import type {
  PaymentGateway,
  PaymentInitializeData,
  PaymentInitializeResult,
  PaymentVerifyResult,
} from '@/lib/payments/payment-gateway';

function resolveChannels(data: PaymentInitializeData): Array<'card' | 'bank_transfer'> {
  if (Array.isArray(data.channels) && data.channels.length > 0) {
    return data.channels;
  }
  return ['card'];
}

export const paystackGateway: PaymentGateway = {
  gateway: 'paystack',

  async initializePayment(data: PaymentInitializeData): Promise<PaymentInitializeResult> {
    const response = await initializePaystackTransaction({
      email: data.email,
      amountKobo: data.amountKobo,
      reference: data.reference,
      callbackUrl: data.callbackUrl,
      channels: resolveChannels(data),
      planCode: data.planCode || null,
      metadata: data.metadata,
    });

    return {
      authorizationUrl: String(response.data.authorization_url || ''),
      reference: String(response.data.reference || data.reference),
      raw: response,
    };
  },

  async verifyPayment(referenceOrTransactionId: string): Promise<PaymentVerifyResult> {
    const response = await verifyPaystackTransaction(referenceOrTransactionId);
    const data = response.data as any;
    const status = String(data?.status || '').toLowerCase();

    const subscriptionRaw = data?.subscription;
    const subscriptionCode =
      typeof subscriptionRaw === 'string'
        ? subscriptionRaw
        : String(subscriptionRaw?.subscription_code || '');
    const subscriptionEmailToken =
      typeof subscriptionRaw === 'object' && subscriptionRaw
        ? String(subscriptionRaw?.email_token || '')
        : '';

    return {
      gateway: 'paystack',
      gatewayTransactionId: data?.id != null ? String(data.id) : null,
      reference: String(data?.reference || referenceOrTransactionId),
      status: status || 'unknown',
      success: status === 'success',
      amountKobo: Number(data?.amount || 0),
      channel: String(data?.channel || 'unknown'),
      paidAt: data?.paid_at ? String(data.paid_at) : null,
      customerEmail: data?.customer?.email ? String(data.customer.email).trim().toLowerCase() : null,
      customerCode: data?.customer?.customer_code ? String(data.customer.customer_code) : null,
      authorizationCode: data?.authorization?.authorization_code
        ? String(data.authorization.authorization_code)
        : null,
      subscriptionCode: subscriptionCode || null,
      subscriptionEmailToken: subscriptionEmailToken || null,
      metadata:
        data?.metadata && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : {},
      raw: response,
    };
  },
};
