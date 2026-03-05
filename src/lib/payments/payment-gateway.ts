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
