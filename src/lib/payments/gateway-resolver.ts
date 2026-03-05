import type { PaymentGateway, PaymentGatewayId } from '@/lib/payments/payment-gateway';
import { paystackGateway } from '@/lib/payments/paystack';
import { flutterwaveGateway } from '@/lib/payments/flutterwave';

export function normalizePaymentGateway(raw: unknown): PaymentGatewayId {
  return String(raw || '').trim().toLowerCase() === 'flutterwave' ? 'flutterwave' : 'paystack';
}

export function getSelectedPaymentGatewayId(): PaymentGatewayId {
  return normalizePaymentGateway(process.env.PAYMENT_GATEWAY);
}

export function getPaymentGatewayById(gatewayId: PaymentGatewayId): PaymentGateway {
  return gatewayId === 'flutterwave' ? flutterwaveGateway : paystackGateway;
}

export function resolvePaymentGateway(): PaymentGateway {
  return getPaymentGatewayById(getSelectedPaymentGatewayId());
}
