import { useSmartAuth } from '@/hooks/use-smart-auth';
import { User, Session } from '@supabase/supabase-js';

export function useSupabaseUser() {
  const { session, isLoading } = useSmartAuth();
  const user = session?.user ?? null;
  // We don't track errors in the smart auth context currently, so returning null for error
  return [user, session, isLoading, null] as const;
}

export function useSupabaseSession() {
  const { session, isLoading } = useSmartAuth();
  return { session, loading: isLoading };
}

export function useIsAdmin(): readonly [boolean, boolean] {
  const [user, , loading] = useSupabaseUser();
  const isAdmin = user?.app_metadata?.role === 'admin' || 
                  user?.user_metadata?.role === 'admin' ||
                  user?.role === 'service_role';
  return [isAdmin, loading] as const;
}
