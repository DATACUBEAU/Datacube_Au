export type PaymentGatewayId = 'paystack' | 'flutterwave';

export type PaymentMethod = 'subscription' | 'transfer';

export type PaymentInitializeData = {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
  channels?: Array<'card' | 'bank_transfer'>;
  planCode?: string | null;
  paymentMethod?: PaymentMethod;
  currency?: string;
};

export type PaymentInitializeResult = {
  authorizationUrl: string;
  reference: string;
  raw?: unknown;
};

export type PaymentVerifyResult = {
  gateway: PaymentGatewayId;
  gatewayTransactionId: string | null;
  reference: string;
  status: string;
  success: boolean;
  amountKobo: number;
  channel: string;
  paidAt: string | null;
  customerEmail: string | null;
  customerCode: string | null;
  authorizationCode: string | null;
  subscriptionCode: string | null;
  subscriptionEmailToken: string | null;
  metadata: Record<string, unknown>;
  raw?: unknown;
};

export interface PaymentGateway {
  readonly gateway: PaymentGatewayId;
  initializePayment(data: PaymentInitializeData): Promise<PaymentInitializeResult>;
  verifyPayment(referenceOrTransactionId: string): Promise<PaymentVerifyResult>;
}

export function getSupportedPaymentMethodsForGateway(gatewayId: PaymentGatewayId): PaymentMethod[] {
  return gatewayId === 'flutterwave' ? ['transfer'] : ['subscription', 'transfer'];
}

export function isPaymentMethodSupportedForGateway(
  gatewayId: PaymentGatewayId,
  paymentMethod: PaymentMethod,
): boolean {
  return getSupportedPaymentMethodsForGateway(gatewayId).includes(paymentMethod);
}

export function getDefaultPaymentMethodForGateway(gatewayId: PaymentGatewayId): PaymentMethod {
  const supported = getSupportedPaymentMethodsForGateway(gatewayId);
  return supported.includes('subscription') ? 'subscription' : 'transfer';
}

export function coercePaymentMethodForGateway(
  gatewayId: PaymentGatewayId,
  requestedPaymentMethod: PaymentMethod | null | undefined,
): PaymentMethod {
  if (requestedPaymentMethod && isPaymentMethodSupportedForGateway(gatewayId, requestedPaymentMethod)) {
    return requestedPaymentMethod;
  }
  return getDefaultPaymentMethodForGateway(gatewayId);
}
