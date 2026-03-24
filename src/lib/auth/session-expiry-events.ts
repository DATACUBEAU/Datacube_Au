import {
  shouldDispatchSessionExpiry,
  type SessionExpiryTriggerIntent,
} from '@/lib/auth/session-expiry-policy';

export const AUTH_SESSION_EXPIRED_EVENT = 'dcau:auth-session-expired';
export const AUTH_REQUIRED_EVENT = 'dcau:auth-required';
export const AUTH_STATE_CHANGED_EVENT = 'dcau:auth-state-changed';
export const AUTH_ACTIONS_DISABLED_KEY = 'dcau:auth-actions-disabled';
export const AUTH_RUNTIME_STATE_KEY = 'dcau:auth-runtime-state';

export type AuthRuntimeState = 'RESTORING' | 'AUTHENTICATED' | 'EXPIRED' | 'REAUTH_IN_PROGRESS';

const DISPATCH_COOLDOWN_MS = 15000;
let lastDispatchAt = 0;
const REAUTH_REDIRECT_COOLDOWN_MS = 5000;
let reauthRedirectClaimed = false;
let lastReauthRedirectAt = 0;

let hasInitializedRuntimeState = false;
let runtimeStateCache: AuthRuntimeState = 'AUTHENTICATED';
const authBoundControllers = new Set<AbortController>();

type SessionExpiredDetail = {
  status?: number;
  source?: string;
  reason?: string;
  intent?: SessionExpiryTriggerIntent;
  at: string;
};

function normalizeRuntimeState(value: unknown): AuthRuntimeState {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'RESTORING') return 'RESTORING';
  if (normalized === 'EXPIRED') return 'EXPIRED';
  if (normalized === 'REAUTH_IN_PROGRESS') return 'REAUTH_IN_PROGRESS';
  return 'AUTHENTICATED';
}

function readRuntimeStateFromStorage(): AuthRuntimeState {
  if (typeof window === 'undefined') return 'AUTHENTICATED';
  try {
    const raw = window.localStorage.getItem(AUTH_RUNTIME_STATE_KEY);
    return normalizeRuntimeState(raw);
  } catch {
    return 'AUTHENTICATED';
  }
}

function writeRuntimeStateToStorage(state: AuthRuntimeState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_RUNTIME_STATE_KEY, state);
  } catch {
    // Ignore storage failures.
  }
}

function ensureRuntimeStateInitialized(): void {
  if (hasInitializedRuntimeState) return;
  runtimeStateCache = readRuntimeStateFromStorage();
  hasInitializedRuntimeState = true;
}

export function getAuthRuntimeState(): AuthRuntimeState {
  ensureRuntimeStateInitialized();
  return runtimeStateCache;
}

export function isAuthLocked(): boolean {
  const state = getAuthRuntimeState();
  return state === 'EXPIRED' || state === 'REAUTH_IN_PROGRESS';
}

export function isAuthRestoring(): boolean {
  return getAuthRuntimeState() === 'RESTORING';
}

export function areAuthActionsDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(AUTH_ACTIONS_DISABLED_KEY);
    if (!raw) return false;
    const value = String(raw).trim().toLowerCase();
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

export function abortAuthBoundRequests(reason = 'auth_required'): void {
  const controllers = Array.from(authBoundControllers);
  authBoundControllers.clear();
  for (const controller of controllers) {
    try {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException(reason, 'AbortError'));
      }
    } catch {
      // Ignore per-controller failures.
    }
  }
}

export function registerAuthBoundAbortController(controller: AbortController): () => void {
  authBoundControllers.add(controller);
  return () => {
    authBoundControllers.delete(controller);
  };
}

export function setAuthRuntimeState(
  nextState: AuthRuntimeState,
  detail?: { source?: string; reason?: string; status?: number },
): void {
  ensureRuntimeStateInitialized();
  const normalized = normalizeRuntimeState(nextState);
  const previous = runtimeStateCache;
  if (previous === normalized) return;

  runtimeStateCache = normalized;
  writeRuntimeStateToStorage(normalized);

  if (normalized === 'EXPIRED' || normalized === 'REAUTH_IN_PROGRESS') {
    abortAuthBoundRequests(normalized.toLowerCase());
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_STATE_CHANGED_EVENT, {
      detail: {
        previous,
        next: normalized,
        source: detail?.source,
        reason: detail?.reason,
        status: detail?.status,
        at: new Date().toISOString(),
      },
    }));
  }

  console.info('[auth-state] transition', {
    from: previous,
    to: normalized,
    source: detail?.source || null,
    reason: detail?.reason || null,
    status: detail?.status || null,
  });
}

export function setAuthActionsDisabled(disabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (disabled) {
      window.localStorage.setItem(AUTH_ACTIONS_DISABLED_KEY, '1');
    } else {
      window.localStorage.removeItem(AUTH_ACTIONS_DISABLED_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function clearAuthActionsDisabled(): void {
  setAuthActionsDisabled(false);
  releaseReauthRedirect();
  setAuthRuntimeState('AUTHENTICATED', {
    source: 'clearAuthActionsDisabled',
    reason: 'session_restored',
  });
}

export function markAuthRestoring(source = 'auth_restore'): void {
  setAuthActionsDisabled(false);
  releaseReauthRedirect();
  setAuthRuntimeState('RESTORING', {
    source,
    reason: 'session_restoring',
  });
}

export function markReauthInProgress(source = 'manual_reauth'): void {
  setAuthActionsDisabled(true);
  setAuthRuntimeState('REAUTH_IN_PROGRESS', { source, reason: 'reauth_started' });
}

export function dispatchSessionExpired(detail?: {
  status?: number;
  source?: string;
  reason?: string;
  intent?: SessionExpiryTriggerIntent;
}): boolean {
  if (typeof window === 'undefined') return false;

  const isOnline =
    window.navigator.onLine !== false &&
    (typeof (window as any).__DCAU_NETWORK_STATE?.isOnline === 'boolean'
      ? (window as any).__DCAU_NETWORK_STATE.isOnline !== false
      : true);

  const state = getAuthRuntimeState();
  if (!shouldDispatchSessionExpiry({
    status: detail?.status,
    runtimeState: state,
    isOnline,
    intent: detail?.intent,
  })) {
    return false;
  }

  const now = Date.now();
  if (now - lastDispatchAt < DISPATCH_COOLDOWN_MS) {
    return false;
  }
  lastDispatchAt = now;

  setAuthActionsDisabled(true);
  setAuthRuntimeState('EXPIRED', {
    source: detail?.source || 'session-expiry',
    reason: detail?.reason || 'auth_error',
    status: detail?.status,
  });

  const payload: SessionExpiredDetail = {
    status: detail?.status,
    source: detail?.source,
    reason: detail?.reason,
    intent: detail?.intent,
    at: new Date(now).toISOString(),
  };

  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: payload }));
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: payload }));
  return true;
}

export function claimReauthRedirect(): boolean {
  if (typeof window === 'undefined') return true;
  const now = Date.now();
  if (reauthRedirectClaimed) return false;
  if (now - lastReauthRedirectAt < REAUTH_REDIRECT_COOLDOWN_MS) return false;
  reauthRedirectClaimed = true;
  lastReauthRedirectAt = now;
  return true;
}

export function releaseReauthRedirect(): void {
  reauthRedirectClaimed = false;
}
