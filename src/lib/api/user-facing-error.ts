import {
  ApiRequestError,
  toApiRequestError,
} from '@/lib/api/api-contract';

export type UserFacingErrorKind =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'document_processing'
  | 'feature_locked'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'degraded'
  | 'internal';

export type UserFacingErrorDescriptor = {
  error: ApiRequestError;
  kind: UserFacingErrorKind;
  title: string;
  description: string;
  retryable: boolean;
  requestId: string | null;
  correlationId: string | null;
};

type UserFacingErrorOptions = {
  context?: 'chat' | 'document' | 'generation' | 'dashboard' | 'background';
  networkState?: 'online' | 'degraded' | 'offline';
};

function codeIncludes(code: string, value: string): boolean {
  return code.includes(value);
}

function isExplicitSessionExpiry(code: string, message: string): boolean {
  if (
    code === 'SESSION_EXPIRED' ||
    code === 'REAUTH_REQUIRED' ||
    code === 'TOKEN_EXPIRED' ||
    code === 'JWT_EXPIRED' ||
    code === 'REFRESH_FAILED'
  ) {
    return true;
  }

  return /\bsession expired\b|\bre-?authentication required\b|\bre-?login required\b|\btoken expired\b|\bjwt expired\b/i.test(message);
}

export function describeApiErrorForUser(
  input: unknown,
  options?: UserFacingErrorOptions,
): UserFacingErrorDescriptor {
  const error = input instanceof ApiRequestError ? input : toApiRequestError(input, 'Unexpected error');
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '');
  const loweredMessage = message.toLowerCase();
  const networkState = options?.networkState ?? 'online';
  const context = options?.context ?? 'dashboard';

  const base = {
    error,
    retryable: Boolean(error.retryable),
    requestId: error.requestId ?? null,
    correlationId: error.correlationId ?? null,
  };

  if (
    networkState === 'offline' ||
    error.status === 0 ||
    code === 'OFFLINE' ||
    loweredMessage.includes('failed to fetch') ||
    loweredMessage.includes('network request failed')
  ) {
    return {
      ...base,
      kind: 'offline',
      title: "You're offline",
      description:
        context === 'background'
          ? 'You’re offline. Showing saved data where available.'
          : 'You’re offline. Reconnect to the internet and try again.',
    };
  }

  if (
    error.status === 401 ||
    code === 'UNAUTHORIZED' ||
    code === 'AUTH_REQUIRED' ||
    code === 'AUTHENTICATION_FAILED'
  ) {
    const sessionExpired = isExplicitSessionExpiry(code, message);
    return {
      ...base,
      kind: 'unauthorized',
      title: sessionExpired ? 'Session expired' : 'Sign in required',
      description: sessionExpired
        ? 'Your session expired. Please sign in again.'
        : 'Please sign in again, then retry this action.',
      retryable: false,
    };
  }

  if (
    error.status === 403 ||
    code === 'FORBIDDEN' ||
    code === 'TIER_ACCESS_DENIED'
  ) {
    return {
      ...base,
      kind: 'forbidden',
      title: 'Access denied',
      description: "You don't have permission to use this feature right now.",
      retryable: false,
    };
  }

  if (
    error.status === 400 ||
    error.status === 422 ||
    codeIncludes(code, 'INVALID') ||
    codeIncludes(code, 'VALIDATION')
  ) {
    return {
      ...base,
      kind: 'validation',
      title: 'Check your request',
      description: 'Something in the request needs attention. Please review it and try again.',
      retryable: false,
    };
  }

  if (
    error.status === 409 ||
    error.status === 423 ||
    codeIncludes(code, 'DOCUMENT_NOT_READY') ||
    codeIncludes(code, 'PROCESSING') ||
    codeIncludes(code, 'IN_PROGRESS') ||
    loweredMessage.includes('still processing') ||
    loweredMessage.includes('generation in progress')
  ) {
    return {
      ...base,
      kind: 'document_processing',
      title: 'Still processing',
      description: 'This document or generation is still processing. Try again shortly.',
      retryable: true,
    };
  }

  if (
    code === 'FEATURE_OUTPUT_FAILED' ||
    codeIncludes(code, 'LOCKED') ||
    loweredMessage.includes('failed cached output') ||
    loweredMessage.includes('generation lock')
  ) {
    return {
      ...base,
      kind: 'feature_locked',
      title: 'Feature temporarily unavailable',
      description: 'This saved result is locked after an earlier failure. Clear the cached output or upload a new version before retrying.',
      retryable: false,
    };
  }

  if (
    error.status === 402 ||
    code === 'UPGRADE_REQUIRED' ||
    code === 'PRO_REQUIRED'
  ) {
    return {
      ...base,
      kind: 'quota',
      title: 'Feature unavailable on this plan',
      description: 'This feature is currently restricted for this account. Upgrade access or switch to an available feature.',
      retryable: false,
    };
  }

  if (
    error.status === 429 ||
    error.isThrottled ||
    code === 'LIMIT_REACHED' ||
    code === 'LIMIT_EXCEEDED' ||
    codeIncludes(code, 'RATE_LIMIT')
  ) {
    return {
      ...base,
      kind: error.status === 429 ? 'rate_limit' : 'quota',
      title: 'Temporary service limit',
      description:
        error.status === 429
          ? 'We hit a temporary service limit. Please wait a bit and retry.'
          : 'This feature is temporarily unavailable because the current usage limit has been reached.',
      retryable: true,
    };
  }

  if (
    error.status === 408 ||
    code === 'REQUEST_TIMEOUT' ||
    code === 'UPSTREAM_TIMEOUT'
  ) {
    return {
      ...base,
      kind: 'timeout',
      title: 'Request timed out',
      description: 'We couldn’t complete that request in time. Please try again in a moment.',
      retryable: true,
    };
  }

  if (
    networkState === 'degraded' ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504 ||
    code === 'MODEL_SERVICE_UNAVAILABLE' ||
    code === 'SERVICE_UNAVAILABLE' ||
    code === 'ROUTING_FAILED' ||
    code === 'BACKEND_RESTRICTED'
  ) {
    return {
      ...base,
      kind: 'degraded',
      title: 'Service temporarily unavailable',
      description:
        networkState === 'degraded'
          ? 'We’re having trouble reaching the service right now. Please try again in a moment.'
          : 'We couldn’t reach the server right now. Please try again in a moment.',
      retryable: true,
    };
  }

  return {
    ...base,
    kind: 'internal',
    title: context === 'chat' ? 'Chat unavailable' : 'Something went wrong',
    description:
      loweredMessage && loweredMessage !== 'unexpected error'
        ? message
        : 'We hit an unexpected problem while processing that request. Please try again shortly.',
  };
}
