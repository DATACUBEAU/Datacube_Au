import { recordUserActivityRpc, supabase } from '@/lib/supabase-client/client';
import { clearClientAuthStorageArtifacts, clearUserScopedClientCaches } from '@/lib/auth/session-storage';
import { clearAuthActionsDisabled } from '@/lib/auth/session-expiry-events';
import { clearServerAuthSessionCookie } from '@/lib/auth/session-cookie';

export async function explicitSignOut(
  userId?: string | null,
  options?: { preserveAuthLock?: boolean },
): Promise<void> {
  if (userId) {
    void recordUserActivityRpc({
      userId,
      event: 'sign_out',
      metadata: {},
    });
  }

  await clearUserScopedClientCaches(userId ?? null);
  clearClientAuthStorageArtifacts();
  clearServerAuthSessionCookie();

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore auth sign-out failures; storage cleanup below is authoritative on client.
    }
  }

  clearClientAuthStorageArtifacts();
  clearServerAuthSessionCookie();
  if (!options?.preserveAuthLock) {
    clearAuthActionsDisabled();
  }
}
