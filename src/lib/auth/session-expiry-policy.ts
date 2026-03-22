export type SessionExpiryRuntimeState =
  | 'RESTORING'
  | 'AUTHENTICATED'
  | 'EXPIRED'
  | 'REAUTH_IN_PROGRESS';

export function shouldDispatchSessionExpiry(input: {
  status?: number;
  runtimeState: SessionExpiryRuntimeState;
  isOnline: boolean;
}): boolean {
  if (!input.isOnline) return false;
  if (input.status === 403) return false;
  if (input.runtimeState === 'RESTORING') return false;
  if (input.runtimeState === 'EXPIRED' || input.runtimeState === 'REAUTH_IN_PROGRESS') {
    return false;
  }
  return true;
}
