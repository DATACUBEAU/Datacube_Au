'use client';

import { useEffect, useState, createContext, useContext, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase-client/client';

interface SmartUser {
  id: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  provider: 'supabase';
}

interface SmartAuthContextType {
  user: SmartUser | null;
  isLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const SmartAuthContext = createContext<SmartAuthContextType | undefined>(undefined);

export function SmartAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SmartUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const syncFromSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;

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
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    syncFromSession().catch(() => {
      if (mounted) setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      syncFromSession().catch(() => {});
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
    setIsLoading(false);
  }, []);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    return null;
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      signInWithGoogle,
      signOut,
      getToken,
    }),
    [user, isLoading, signInWithGoogle, signOut, getToken]
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
