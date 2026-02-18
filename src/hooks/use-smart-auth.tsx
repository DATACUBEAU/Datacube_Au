'use client';

import { useEffect, useState, createContext, useContext, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase-client/client';
import { Session } from '@supabase/supabase-js';

interface SmartUser {
  id: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  provider: 'supabase';
}

interface SmartAuthContextType {
  user: SmartUser | null;
  session: Session | null;
  isAuthed: boolean;
  isLoadingAuth: boolean;
  isLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const SmartAuthContext = createContext<SmartAuthContextType | undefined>(undefined);

export function SmartAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SmartUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const syncFromSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        
        setSession(data.session);

        if (data.session?.user) {
          setUser({
            id: data.session.user.id,
            email: data.session.user.email,
            full_name: data.session.user.user_metadata?.full_name || data.session.user.user_metadata?.name,
            avatar_url: data.session.user.user_metadata?.avatar_url,
            provider: 'supabase',
          });
        } else {
          setUser(null);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    syncFromSession().catch(() => {
      if (mounted) setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted) {
        setSession(session);
        if (session?.user) {
           setUser({
            id: session.user.id,
            email: session.user.email,
            full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
            avatar_url: session.user.user_metadata?.avatar_url,
            provider: 'supabase',
          });
        } else {
          setUser(null);
        }
        setIsLoading(false);
      }
      
      // Ensure user consistency on sign-in
      if (event === 'SIGNED_IN' && session?.user) {
        supabase.rpc('ensure_user_consistency').then(({ error }) => {
            if (error) {
              console.error('Consistency check failed:', error);
            }
        });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setIsLoading(true);
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/dashboard` : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (error) {
      setIsLoading(false);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    setIsLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsLoading(false);
  }, []);

  const getToken = useCallback(async () => {
    // If we have a session in state, use it (it's kept up to date by the listener)
    if (session?.access_token) return session.access_token;
    
    // Fallback to fetching fresh
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    return null;
  }, [session]);

  const isAuthed = !!session?.access_token && !!session?.user;

  const value = useMemo(
    () => ({
      user,
      session,
      isAuthed,
      isLoadingAuth: isLoading,
      isLoading,
      signInWithGoogle,
      signOut,
      getToken,
    }),
    [user, session, isAuthed, isLoading, signInWithGoogle, signOut, getToken]
  );

  return (
    <SmartAuthContext.Provider value={value}>
      {children}
    </SmartAuthContext.Provider>
  );
}

export function useSmartAuth() {
  const context = useContext(SmartAuthContext);
  if (context === undefined) {
    throw new Error('useSmartAuth must be used within a SmartAuthProvider');
  }
  return context;
}
