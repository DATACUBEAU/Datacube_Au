import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase-client/client';

export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    };

    sync().catch(() => {
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return [session, loading, null] as const;
}

export function useSupabaseUser(): readonly [User | null, boolean, Error | null] {
  const [session, loading, error] = useSupabaseSession();
  return [session?.user ?? null, loading, error] as const;
}

export function useIsAdmin(): readonly [boolean, boolean] {
  const [user, loading] = useSupabaseUser();
  const isAdmin = user?.app_metadata?.role === 'admin' || 
                  user?.user_metadata?.role === 'admin' ||
                  user?.role === 'service_role';
  return [isAdmin, loading] as const;
}
