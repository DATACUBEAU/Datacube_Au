'use client';

import { useEffect, useState, createContext, useContext, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase-client/client';
import { Session } from '@supabase/supabase-js';
import { readPersistedSupabaseSession } from '@/lib/auth/session-storage';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import {
  AUTH_STATE_CHANGED_EVENT,
  clearAuthActionsDisabled,
  getAuthRuntimeState,
  markReauthInProgress,
  type AuthRuntimeState,
} from '@/lib/auth/session-expiry-events';

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
  authState: 'loading' | 'authenticated' | 'unauthenticated';
  runtimeAuthState: AuthRuntimeState;
  isOfflineSession: boolean;
  isAuthLocked: boolean;
  isAuthed: boolean;
  isLoadingAuth: boolean;
  isLoading: boolean;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
  startReauth: (source?: string) => void;
  getToken: () => Promise<string | null>;
}

const SmartAuthContext = createContext<SmartAuthContextType | undefined>(undefined);

export function SmartAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SmartUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [runtimeAuthState, setRuntimeAuthState] = useState<AuthRuntimeState>('AUTHENTICATED');
  const sessionSignatureRef = useRef<string | null>(null);
  const authStateRef = useRef<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  const sessionToUser = useCallback((nextSession: Session | null): SmartUser | null => {
    if (!nextSession?.user) return null;
    return {
      id: nextSession.user.id,
      email: nextSession.user.email,
      full_name: nextSession.user.user_metadata?.full_name || nextSession.user.user_metadata?.name,
      avatar_url: nextSession.user.user_metadata?.avatar_url,
      provider: 'supabase',
    };
  }, []);

  const signatureFromSession = useCallback((nextSession: Session | null) => {
    if (!nextSession?.user?.id || !nextSession?.access_token) return null;
    const tokenTail = nextSession.access_token.slice(-12);
    const expires = typeof nextSession.expires_at === 'number' ? nextSession.expires_at : 0;
    return `${nextSession.user.id}:${tokenTail}:${expires}`;
  }, []);

  const applySessionState = useCallback(
    (nextSession: Session | null, options?: { offlineBootstrap?: boolean; force?: boolean }) => {
      const signature = signatureFromSession(nextSession);
      if (!options?.force && signature && signature === sessionSignatureRef.current) {
        return;
      }

      sessionSignatureRef.current = signature;
      setSession(nextSession);
      setUser(sessionToUser(nextSession));
      const nextAuthState = nextSession?.user ? 'authenticated' : 'unauthenticated';
      authStateRef.current = nextAuthState;
      setAuthState(nextAuthState);
      setIsOfflineSession(Boolean(options?.offlineBootstrap && nextSession?.user));
    },
    [sessionToUser, signatureFromSession],
  );

  useEffect(() => {
    setRuntimeAuthState(getAuthRuntimeState());
    const handleRuntimeAuthStateChange = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const next = typeof detail?.next === 'string' ? detail.next : getAuthRuntimeState();
      setRuntimeAuthState(next as AuthRuntimeState);
    };
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleRuntimeAuthStateChange as EventListener);

    let mounted = true;
    const recordSignIn = (userId: string) => {
      void (async () => {
        try {
          await supabase.rpc('record_user_activity', {
            p_user_id: userId,
            p_event: 'sign_in',
            p_metadata: {},
          });
        } catch {
          // best-effort audit update
        }
      })();
    };

    const syncInitialSession = async () => {
      const offlineAtBoot =
        typeof window !== 'undefined' &&
        (window.navigator.onLine === false ||
          (typeof (window as any).__DCAU_NETWORK_STATE?.isOnline === 'boolean' &&
            (window as any).__DCAU_NETWORK_STATE.isOnline === false));

      if (offlineAtBoot) {
        const persisted = readPersistedSupabaseSession();
        if (!mounted) return;
        applySessionState(persisted, { offlineBootstrap: true, force: true });
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        const fallbackSession = readPersistedSupabaseSession();
        const nextSession = data.session ?? fallbackSession;
        applySessionState(nextSession, {
          force: true,
          offlineBootstrap: Boolean(!data.session && nextSession?.user),
        });
        if (nextSession?.user?.id) {
          clearAuthActionsDisabled();
          recordSignIn(nextSession.user.id);
        }
      } catch {
        if (!mounted) return;
        const persisted = readPersistedSupabaseSession();
        applySessionState(persisted, {
          force: true,
          offlineBootstrap: Boolean(persisted?.user),
        });
        if (persisted?.user?.id) {
          clearAuthActionsDisabled();
        }
      }
    };

    void syncInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      applySessionState(session);
      if (event !== 'SIGNED_OUT') {
        setIsOfflineSession(false);
      }
      if (event === 'SIGNED_IN' && session?.user?.id) {
        clearAuthActionsDisabled();
        recordSignIn(session.user.id);
      }

      // Ensure user consistency on sign-in
      if (event === 'SIGNED_IN' && session?.user) {
        void supabase.rpc('ensure_user_consistency').then(({ error }) => {
          if (error) {
            console.error('Consistency check failed:', error);
          }
        });
      }
    });

    const handleOnline = () => {
      if (!mounted) return;
      if (authStateRef.current === 'authenticated') {
        void supabase.auth.getSession().then(({ data }) => {
          if (!mounted) return;
          const persisted = readPersistedSupabaseSession();
          const nextSession = data.session ?? persisted;
          if (!nextSession) {
            applySessionState(null);
            setIsOfflineSession(false);
            return;
          }
          applySessionState(nextSession, {
            force: !data.session,
            offlineBootstrap: Boolean(!data.session && nextSession.user),
          });
          if (nextSession?.user?.id) {
            clearAuthActionsDisabled();
          }
          setIsOfflineSession(!data.session);
        }).catch(() => {
          if (!mounted) return;
          const persisted = readPersistedSupabaseSession();
          if (persisted?.user) {
            applySessionState(persisted, { force: true, offlineBootstrap: true });
            setIsOfflineSession(true);
            return;
          }
          setIsOfflineSession(true);
        });
      }
    };

    const handleOffline = () => {
      if (!mounted) return;
      if (sessionSignatureRef.current) {
        setIsOfflineSession(true);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, handleRuntimeAuthStateChange as EventListener);
    };
  }, [applySessionState]);

  const signInWithGoogle = useCallback(async (redirectPath?: string) => {
    authStateRef.current = 'loading';
    setAuthState('loading');
    const safePath =
      typeof redirectPath === 'string' &&
      redirectPath.startsWith('/') &&
      !redirectPath.startsWith('//')
        ? redirectPath
        : '/dashboard';
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}${safePath}` : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (error) {
      const nextState = session ? 'authenticated' : 'unauthenticated';
      authStateRef.current = nextState;
      setAuthState(nextState);
      throw error;
    }
  }, [session]);

  const signOut = useCallback(async () => {
    authStateRef.current = 'loading';
    setAuthState('loading');
    await explicitSignOut(session?.user?.id ?? null);
    applySessionState(null, { force: true });
  }, [applySessionState, session?.user?.id]);

  const startReauth = useCallback((source?: string) => {
    markReauthInProgress(source || 'useSmartAuth.startReauth');
    setRuntimeAuthState('REAUTH_IN_PROGRESS');
  }, []);

  const getToken = useCallback(async () => {
    // If we have a session in state, use it (it's kept up to date by the listener)
    if (session?.access_token) return session.access_token;
    
    // Fallback to fetching fresh
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    return null;
  }, [session]);

  const isAuthed = authState === 'authenticated';
  const isLoading = authState === 'loading';
  const isAuthLocked = runtimeAuthState === 'EXPIRED' || runtimeAuthState === 'REAUTH_IN_PROGRESS';

  const value = useMemo(
    () => ({
      user,
      session,
      authState,
      runtimeAuthState,
      isOfflineSession,
      isAuthLocked,
      isAuthed,
      isLoadingAuth: isLoading,
      isLoading,
      signInWithGoogle,
      signOut,
      startReauth,
      getToken,
    }),
    [
      user,
      session,
      authState,
      runtimeAuthState,
      isOfflineSession,
      isAuthLocked,
      isAuthed,
      isLoading,
      signInWithGoogle,
      signOut,
      startReauth,
      getToken,
    ]
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
