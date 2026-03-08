import { firstEnv } from './env';
import type { PaymentGatewayId } from '../payments/payment-gateway';

export type BillingConfigAction =
  | 'checkout_initialize'
  | 'payment_verify'
  | 'subscription_cancel'
  | 'webhook';

export type BillingGatewayCapability = {
  enabled: boolean;
  gateway: PaymentGatewayId;
  issue: {
    code: string;
    message: string;
    missingEnv: string[];
    action: BillingConfigAction;
    gateway: PaymentGatewayId;
  } | null;
};

export class BillingApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || {};
  }
}

export class BillingConfigurationError extends BillingApiError {
  constructor(input: {
    gateway: PaymentGatewayId;
    action: BillingConfigAction;
    missingEnv: string[];
  }) {
    super(
      503,
      'billing_gateway_not_configured',
      `${input.gateway} billing is not configured on the server.`,
      {
        gateway: input.gateway,
        action: input.action,
        missingEnv: input.missingEnv,
      },
    );
  }
}

const loggedCapabilityIssues = new Set<string>();

function resolveMissingGatewayEnv(gateway: PaymentGatewayId, action: BillingConfigAction): string[] {
  if (gateway === 'flutterwave') {
    const missing: string[] = [];
    if (!firstEnv('FLUTTERWAVE_SECRET_KEY')) {
      missing.push('FLUTTERWAVE_SECRET_KEY');
    }
    if (action === 'webhook' && !firstEnv('FLUTTERWAVE_WEBHOOK_SECRET_HASH', 'FLUTTERWAVE_SECRET_HASH')) {
      missing.push('FLUTTERWAVE_WEBHOOK_SECRET_HASH');
    }
    return missing;
  }

  const missing: string[] = [];
  if (!firstEnv('PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET')) {
    missing.push('PAYSTACK_SECRET_KEY');
  }
  return missing;
}

function describeGatewayIssue(gateway: PaymentGatewayId, action: BillingConfigAction): string {
  if (gateway === 'flutterwave') {
    if (action === 'webhook') return 'Flutterwave webhook validation is not configured on the server.';
    return 'Flutterwave checkout is not configured on the server.';
  }
  if (action === 'webhook') return 'Paystack webhook validation is not configured on the server.';
  if (action === 'subscription_cancel') return 'Paystack subscription cancellation is not configured on the server.';
  if (action === 'payment_verify') return 'Paystack payment verification is not configured on the server.';
  return 'Paystack checkout is not configured on the server.';
}

function logCapabilityIssue(issue: NonNullable<BillingGatewayCapability['issue']>) {
  const cacheKey = `${issue.gateway}:${issue.action}:${issue.code}:${issue.missingEnv.join(',')}`;
  if (loggedCapabilityIssues.has(cacheKey)) return;
  loggedCapabilityIssues.add(cacheKey);
  console.error('[billing-config] missing required billing env', issue);
}

export function getBillingGatewayCapability(input: {
  gateway: PaymentGatewayId;
  action: BillingConfigAction;
}): BillingGatewayCapability {
  const missingEnv = resolveMissingGatewayEnv(input.gateway, input.action);
  if (missingEnv.length === 0) {
    return {
      enabled: true,
      gateway: input.gateway,
      issue: null,
    };
  }

  const issue = {
    code: `${input.gateway}_env_missing`,
    message: describeGatewayIssue(input.gateway, input.action),
    missingEnv,
    action: input.action,
    gateway: input.gateway,
  };
  logCapabilityIssue(issue);

  return {
    enabled: false,
    gateway: input.gateway,
    issue,
  };
}

export function assertBillingGatewayCapability(input: {
  gateway: PaymentGatewayId;
  action: BillingConfigAction;
}): BillingGatewayCapability {
  const capability = getBillingGatewayCapability(input);
  if (capability.enabled) {
    return capability;
  }
  throw new BillingConfigurationError({
    gateway: input.gateway,
    action: input.action,
    missingEnv: capability.issue?.missingEnv || [],
  });
}

export function serializeBillingApiError(
  error: unknown,
  fallback: {
    status: number;
    code: string;
    message: string;
    requestId: string;
  },
): { status: number; body: Record<string, unknown> } {
  if (error instanceof BillingApiError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        message: error.message,
        requestId: fallback.requestId,
        details: error.details,
      },
    };
  }

  const numericStatus = Number((error as any)?.status || 0);
  const status =
    Number.isFinite(numericStatus) && numericStatus >= 500 && numericStatus <= 599
      ? numericStatus
      : fallback.status;
  const details = (error as any)?.details;

  return {
    status,
    body: {
      error: fallback.code,
      message: String((error as any)?.message || fallback.message),
      requestId: fallback.requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
