import { supabase } from '@/lib/supabase-client/client';
import { clearClientAuthStorageArtifacts, clearUserScopedClientCaches } from '@/lib/auth/session-storage';
import { clearAuthActionsDisabled } from '@/lib/auth/session-expiry-events';

export async function explicitSignOut(
  userId?: string | null,
  options?: { preserveAuthLock?: boolean },
): Promise<void> {
  if (userId) {
    void (async () => {
      try {
        await supabase.rpc('record_user_activity', {
          p_user_id: userId,
          p_event: 'sign_out',
          p_metadata: {},
        } as any);
      } catch {
        // Best-effort audit update.
      }
    })();
  }

  await clearUserScopedClientCaches(userId ?? null);
  clearClientAuthStorageArtifacts();

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
  if (!options?.preserveAuthLock) {
    clearAuthActionsDisabled();
  }
}
