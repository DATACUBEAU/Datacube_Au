export type BillingGatewayHint = 'paystack' | 'flutterwave' | null;

type SearchParamLike = {
  get(name: string): string | null;
};

type PaymentReturnSource = SearchParamLike | Record<string, unknown> | null | undefined;

export type BillingReturnState = {
  reference: string | null;
  verificationTarget: string | null;
  transactionId: string | null;
  gatewayHint: BillingGatewayHint;
  isSuccess: boolean;
  isCanceled: boolean;
  hasCallbackState: boolean;
};

const SUCCESS_STATUSES = new Set(['success', 'successful', 'completed']);
const CANCELED_STATUSES = new Set(['cancelled', 'canceled', 'failed']);

function hasSearchParamGetter(value: unknown): value is SearchParamLike {
  return Boolean(value && typeof value === 'object' && typeof (value as SearchParamLike).get === 'function');
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = firstString(item);
      if (normalized) return normalized;
    }
  }
  return '';
}

function readValue(source: PaymentReturnSource, key: string): string {
  if (!source) return '';
  if (hasSearchParamGetter(source)) {
    return String(source.get(key) || '').trim();
  }
  return firstString((source as Record<string, unknown>)[key]);
}

function firstNonEmpty(values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = firstString(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeGatewayHint(raw: unknown): BillingGatewayHint {
  const value = firstString(raw).toLowerCase();
  if (value === 'paystack' || value === 'flutterwave') {
    return value;
  }
  return null;
}

export function extractBillingReturnState(source: PaymentReturnSource): BillingReturnState {
  const directReference = firstNonEmpty([
    readValue(source, 'reference'),
    readValue(source, 'trxref'),
    readValue(source, 'tx_ref'),
  ]);
  const explicitVerificationTarget = firstNonEmpty([
    readValue(source, 'verification_target'),
    readValue(source, 'verificationTarget'),
  ]);
  const transactionId = firstNonEmpty([
    readValue(source, 'transaction_id'),
    readValue(source, 'transactionId'),
  ]);
  const status = readValue(source, 'status').toLowerCase();
  const successFlag = readValue(source, 'success').toLowerCase() === 'true';
  const canceledFlag = readValue(source, 'cancelled').toLowerCase() === 'true';
  const explicitGatewayHint = normalizeGatewayHint(readValue(source, 'gateway'));
  const inferredGatewayHint =
    explicitGatewayHint ||
    (readValue(source, 'tx_ref') || transactionId ? 'flutterwave' : readValue(source, 'trxref') ? 'paystack' : null);

  return {
    reference: directReference,
    verificationTarget: firstNonEmpty([explicitVerificationTarget, directReference, transactionId]),
    transactionId,
    gatewayHint: inferredGatewayHint,
    isSuccess: successFlag || SUCCESS_STATUSES.has(status),
    isCanceled: canceledFlag || CANCELED_STATUSES.has(status),
    hasCallbackState: Boolean(
      directReference ||
      transactionId ||
      status ||
      readValue(source, 'success') ||
      readValue(source, 'cancelled')
    ),
  };
}
