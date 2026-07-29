export type SessionExpiryRuntimeState =
  | 'RESTORING'
  | 'AUTHENTICATED'
  | 'UNAUTHENTICATED'
  | 'EXPIRED'
  | 'REAUTH_IN_PROGRESS';

export type SessionExpiryTriggerIntent = 'interactive' | 'background' | 'bootstrap';

export function shouldDispatchSessionExpiry(input: {
  status?: number;
  runtimeState: SessionExpiryRuntimeState;
  isOnline: boolean;
  intent?: SessionExpiryTriggerIntent;
}): boolean {
  if (!input.isOnline) return false;
  if (input.status !== 401) return false;
  if ((input.intent ?? 'interactive') !== 'interactive') return false;
  if (input.runtimeState === 'RESTORING') return false;
  if (input.runtimeState === 'UNAUTHENTICATED') return false;
  if (input.runtimeState === 'EXPIRED' || input.runtimeState === 'REAUTH_IN_PROGRESS') {
    return false;
  }
  return true;
}

export function shouldDeferProtectedRequest(input: {
  requireAuth?: boolean;
  isAuthLoading: boolean;
  isAuthRestoring: boolean;
  isAuthLocked: boolean;
}): boolean {
  if (input.requireAuth === false) return false;
  return input.isAuthLoading || input.isAuthRestoring || input.isAuthLocked;
}
