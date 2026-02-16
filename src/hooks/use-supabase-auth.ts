import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase-client/client';
import { User, Session } from '@supabase/supabase-js';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

// Simple in-memory cache for user/session
let cachedUser: User | null = null;
let cachedSession: Session | null = null;

export function useSupabaseUser() {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [session, setSession] = useState<Session | null>(cachedSession);
  const [loading, setLoading] = useState(!cachedUser); // If cached, not loading
  const [error, setError] = useState<Error | null>(null);
  
  const { isOnline } = useNetworkStatus();
  const mounted = useRef(true);

  const fetchUser = useCallback(async () => {
    if (!mounted.current) return;
    
    // If offline and we have cache, stop loading immediately
    if (!isOnline && cachedUser) {
        setLoading(false);
        return;
    }

    try {
      // Set timeout for auth check to prevent infinite spinning
      const { data, error } = await Promise.race([
          supabase.auth.getSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Auth check timed out')), 5000))
      ]) as any;

      if (error) throw error;

      if (mounted.current) {
        if (data.session) {
            setSession(data.session);
            setUser(data.session.user);
            cachedSession = data.session;
            cachedUser = data.session.user;
        } else {
            setSession(null);
            setUser(null);
            cachedSession = null;
            cachedUser = null;
        }
      }
    } catch (e: any) {
      if (mounted.current) {
          console.warn("[Auth] Check failed or timed out:", e);
          setError(e);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    mounted.current = true;
    fetchUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted.current) {
        setSession(session);
        setUser(session?.user ?? null);
        cachedSession = session;
        cachedUser = session?.user ?? null;
        setLoading(false);
      }
    });

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, [fetchUser]);

  return [user, session, loading, error] as const;
}

export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(cachedSession);
  const [loading, setLoading] = useState(!cachedSession);

  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    // If we have a cached session, we can skip the initial loading state
    if (cachedSession) {
      setSession(cachedSession);
      setLoading(false);
    }

    const fetchSession = async () => {
      // If offline and we have a cached session, don't try to fetch
      if (!isOnline && cachedSession) return;

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        
        if (data.session) {
            setSession(data.session);
            cachedSession = data.session;
            cachedUser = data.session.user;
        }
      } catch (error) {
        console.warn('Error fetching session:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      cachedSession = session;
      cachedUser = session?.user ?? null;
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [isOnline]);

  return { session, loading };
}

export function useIsAdmin(): readonly [boolean, boolean] {
  const [user, , loading] = useSupabaseUser();
  const isAdmin = user?.app_metadata?.role === 'admin' || 
                  user?.user_metadata?.role === 'admin' ||
                  user?.role === 'service_role';
  return [isAdmin, loading] as const;
}
