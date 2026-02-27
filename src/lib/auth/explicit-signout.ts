import { supabase } from '@/lib/supabase-client/client';
import { clearUserScopedClientCaches } from '@/lib/auth/session-storage';
import { clearAuthActionsDisabled } from '@/lib/auth/session-expiry-events';

export async function explicitSignOut(userId?: string | null): Promise<void> {
  try {
    await supabase.rpc('record_user_activity', {
      p_user_id: userId ?? null,
      p_event: 'sign_out',
      p_metadata: {},
    } as any);
  } catch {
  }
  await clearUserScopedClientCaches(userId ?? null);
  await supabase.auth.signOut();
  clearAuthActionsDisabled();
}
