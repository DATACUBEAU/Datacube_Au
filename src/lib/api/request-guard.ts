import { logOnce } from '@/lib/log/dedupe';

export type GuardFailureReason = 'offline' | 'unauthenticated';

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: GuardFailureReason; message: string };

type GuardInput = {
  isOnline: boolean;
  requireAuth?: boolean;
  accessToken?: string | null;
  allowOfflineRead?: boolean;
  warnKey?: string;
  context?: string;
};

export function guardRequest(input: GuardInput): GuardResult {
  const requireAuth = input.requireAuth !== false;
  const allowOfflineRead = input.allowOfflineRead === true;
  const hasToken = Boolean(input.accessToken && String(input.accessToken).trim().length > 0);

  if (!input.isOnline && !allowOfflineRead) {
    const message = 'Offline: action unavailable.';
    if (input.warnKey) {
      logOnce('warn', `guard:${input.warnKey}:offline`, `[request-guard] ${input.context || 'request'} blocked: offline`);
    }
    return { ok: false, reason: 'offline', message };
  }

  if (requireAuth && !hasToken) {
    const message = 'Sign in required.';
    if (input.warnKey) {
      logOnce(
        'warn',
        `guard:${input.warnKey}:auth`,
        `[request-guard] ${input.context || 'request'} blocked: missing access token`,
      );
    }
    return { ok: false, reason: 'unauthenticated', message };
  }

  return { ok: true };
}

