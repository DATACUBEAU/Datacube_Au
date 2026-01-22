import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, getGuestToken } from '@/lib/supabase/client';

export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.warn('Auth session error in useSupabaseSession:', error.message);
          // Only sign out if absolutely necessary (e.g., truly invalid session that blocks things)
          // But usually we want to avoid unintended reloads
          throw error;
        }

        if (mounted) {
          if (data.session) {
            setSession(data.session);
            setError(null);
          } else {
            // If there is a guest token, ensure we also have a real Supabase anonymous session
            const guestToken = getGuestToken();
            if (guestToken) {
              const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
              if (anonError) throw anonError;
              setSession(anonData.session ?? null);
              setError(null);
            } else {
               setSession(null);
            }
          }
          setLoading(false);
        }
      } catch (e) {
        if (mounted) {
          console.error('Session check failed:', e);
          setError(e as Error);
          setSession(null);
          setLoading(false);
        }
      }
    };

    checkSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession) {
        setSession(nextSession);
      } else {
        // If auth state changes to null (sign out), check guest again?
        // Usually sign out means clearing everything.
        // But if we are supporting mixed mode, we should just follow auth state.
        // If user signs out, we might want to clear guest token too.
        if (event === 'SIGNED_OUT') {
             // Optional: Clear guest token on explicit sign out?
             // For now, let's assume sign out clears user session.
             // If we want to fallback to guest, we'd need to re-check.
             setSession(null);
        } else {
             setSession(null);
        }
      }
      setLoading(false);
      setError(null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return [session, loading, error] as const;
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
