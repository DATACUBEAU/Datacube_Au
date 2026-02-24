import { supabase } from '@/lib/supabase-client/client';
import { clearUserScopedClientCaches } from '@/lib/auth/session-storage';

export async function explicitSignOut(userId?: string | null): Promise<void> {
  await clearUserScopedClientCaches(userId ?? null);
  await supabase.auth.signOut();
}

