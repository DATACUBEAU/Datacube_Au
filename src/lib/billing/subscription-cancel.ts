export type SubscriptionCancelMode = 'noop' | 'remote_cancel' | 'local_schedule';
export type SubscriptionResumeMode = 'noop' | 'remote_resume' | 'local_resume';

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

export type SubscriptionResumeResolution = {
  mode: SubscriptionResumeMode;
  reason:
    | 'no_subscription'
    | 'already_renewing'
    | 'already_stopped'
    | 'remote_resume_supported'
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

export function resolveSubscriptionResumption(input: {
  status?: unknown;
  cancelAtPeriodEnd?: boolean;
  gateway?: unknown;
  paystackSubscriptionCode?: unknown;
  paystackEmailToken?: unknown;
}): SubscriptionResumeResolution {
  const status = normalizeText(input.status);
  if (!status) {
    return {
      mode: 'noop',
      reason: 'no_subscription',
    };
  }

  if (STOPPED_STATUSES.has(status)) {
    return {
      mode: 'noop',
      reason: 'already_stopped',
    };
  }

  if (input.cancelAtPeriodEnd !== true && status !== 'non_renewing') {
    return {
      mode: 'noop',
      reason: 'already_renewing',
    };
  }

  const gateway = normalizeText(input.gateway) || 'paystack';
  const hasPaystackCredentials = Boolean(
    String(input.paystackSubscriptionCode || '').trim() &&
    String(input.paystackEmailToken || '').trim()
  );

  if (gateway === 'paystack' && hasPaystackCredentials) {
    return {
      mode: 'remote_resume',
      reason: 'remote_resume_supported',
    };
  }

  if (gateway !== 'paystack') {
    return {
      mode: 'local_resume',
      reason: 'unsupported_gateway',
    };
  }

  return {
    mode: 'local_resume',
    reason: 'missing_gateway_credentials',
  };
}
