export type SubscriptionCancelMode = 'noop' | 'remote_cancel' | 'local_schedule';

export type SubscriptionCancelResolution = {
  mode: SubscriptionCancelMode;
  reason:
    | 'no_subscription'
    | 'already_non_renewing'
    | 'already_stopped'
    | 'remote_cancel_supported'
    | 'missing_gateway_credentials'
    | 'unsupported_gateway';
};

const STOPPED_STATUSES = new Set(['canceled', 'cancelled', 'expired']);

function normalizeText(raw: unknown): string {
  return String(raw || '').trim().toLowerCase();
}

export function resolveSubscriptionCancellation(input: {
  status?: unknown;
  cancelAtPeriodEnd?: boolean;
  gateway?: unknown;
  paystackSubscriptionCode?: unknown;
  paystackEmailToken?: unknown;
}): SubscriptionCancelResolution {
  const status = normalizeText(input.status);
  if (!status) {
    return {
      mode: 'noop',
      reason: 'no_subscription',
    };
  }

  if (input.cancelAtPeriodEnd === true || status === 'non_renewing') {
    return {
      mode: 'noop',
      reason: 'already_non_renewing',
    };
  }

  if (STOPPED_STATUSES.has(status)) {
    return {
      mode: 'noop',
      reason: 'already_stopped',
    };
  }

  const gateway = normalizeText(input.gateway) || 'paystack';
  const hasPaystackCredentials = Boolean(
    String(input.paystackSubscriptionCode || '').trim() &&
    String(input.paystackEmailToken || '').trim()
  );

  if (gateway === 'paystack' && hasPaystackCredentials) {
    return {
      mode: 'remote_cancel',
      reason: 'remote_cancel_supported',
    };
  }

  if (gateway !== 'paystack') {
    return {
      mode: 'local_schedule',
      reason: 'unsupported_gateway',
    };
  }

  return {
    mode: 'local_schedule',
    reason: 'missing_gateway_credentials',
  };
}
