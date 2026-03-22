'use client';

import { useEffect, useState, createContext, useContext, useMemo, useCallback, useRef } from 'react';
import { recordUserActivityRpc, supabase } from '@/lib/supabase-client/client';
import { Session } from '@supabase/supabase-js';
import { readPersistedSupabaseSession } from '@/lib/auth/session-storage';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { hasServerAuthSessionCookie, syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import {
  AUTH_STATE_CHANGED_EVENT,
  clearAuthActionsDisabled,
  getAuthRuntimeState,
  markAuthRestoring,
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
  isRestoringAuth: boolean;
  isAuthed: boolean;
  isLoadingAuth: boolean;
  isLoading: boolean;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
  startReauth: (source?: string) => void;
  getToken: () => Promise<string | null>;
}

const SmartAuthContext = createContext<SmartAuthContextType | undefined>(undefined);
const SESSION_EXPIRY_SKEW_MS = 5_000;

function sessionToBootstrapUser(nextSession: Session | null): SmartUser | null {
  if (!nextSession?.user) return null;
  return {
    id: nextSession.user.id,
    email: nextSession.user.email,
    full_name: nextSession.user.user_metadata?.full_name || nextSession.user.user_metadata?.name,
    avatar_url: nextSession.user.user_metadata?.avatar_url,
    provider: 'supabase',
  };
}

function normalizeBootstrapSession(candidate: Session | null): Session | null {
  if (!candidate?.user?.id || !candidate?.access_token) return null;
  const expiresAt = typeof candidate.expires_at === 'number' ? candidate.expires_at : null;
  if (expiresAt !== null && expiresAt * 1000 <= Date.now() + SESSION_EXPIRY_SKEW_MS) {
    return null;
  }
  return candidate;
}

function signatureFromBootstrapSession(nextSession: Session | null): string | null {
  if (!nextSession?.user?.id || !nextSession?.access_token) return null;
  const tokenTail = nextSession.access_token.slice(-12);
  const expires = typeof nextSession.expires_at === 'number' ? nextSession.expires_at : 0;
  return `${nextSession.user.id}:${tokenTail}:${expires}`;
}

export function SmartAuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrapSession = useMemo(
    () =>
      normalizeBootstrapSession(
        typeof window !== 'undefined' ? readPersistedSupabaseSession() : null,
      ),
    [],
  );
  const [user, setUser] = useState<SmartUser | null>(() => sessionToBootstrapUser(bootstrapSession));
  const [session, setSession] = useState<Session | null>(() => bootstrapSession);
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>(
    () => (bootstrapSession?.user ? 'authenticated' : 'loading'),
  );
  const [isOfflineSession, setIsOfflineSession] = useState(
    () => Boolean(bootstrapSession?.user && typeof window !== 'undefined' && window.navigator.onLine === false),
  );
  const [runtimeAuthState, setRuntimeAuthState] = useState<AuthRuntimeState>('AUTHENTICATED');
  const sessionSignatureRef = useRef<string | null>(signatureFromBootstrapSession(bootstrapSession));
  const authStateRef = useRef<'loading' | 'authenticated' | 'unauthenticated'>(
    bootstrapSession?.user ? 'authenticated' : 'loading',
  );

  const sessionToUser = useCallback((nextSession: Session | null): SmartUser | null => {
    return sessionToBootstrapUser(nextSession);
  }, []);

  const signatureFromSession = useCallback((nextSession: Session | null) => {
    return signatureFromBootstrapSession(nextSession);
  }, []);

  const normalizeSession = useCallback((candidate: Session | null): Session | null => {
    return normalizeBootstrapSession(candidate);
  }, []);

  const isOnlineNow = useCallback(() => {
    if (typeof window === 'undefined') return true;
    if (typeof (window as any).__DCAU_NETWORK_STATE?.isOnline === 'boolean') {
      return (window as any).__DCAU_NETWORK_STATE.isOnline !== false;
    }
    return window.navigator.onLine !== false;
  }, []);

  const resolveSessionFromSupabase = useCallback(async () => {
    const persisted = normalizeSession(readPersistedSupabaseSession());

    if (!isOnlineNow()) {
      return {
        session: persisted,
        usedCachedSession: Boolean(persisted?.user),
      };
    }

    try {
      const { data, error } = await supabase.auth.getSession();
      let liveSession = normalizeSession(error ? null : data.session ?? null);

      if (!liveSession) {
        const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
        liveSession = normalizeSession(refreshError ? null : refreshedData.session ?? null);
      }

      const nextSession = liveSession ?? persisted;
      return {
        session: nextSession,
        usedCachedSession: Boolean(!liveSession && nextSession?.user),
      };
    } catch {
      return {
        session: persisted,
        usedCachedSession: Boolean(persisted?.user),
      };
    }
  }, [isOnlineNow, normalizeSession]);

  const applySessionState = useCallback(
    (nextSession: Session | null, options?: { offlineBootstrap?: boolean; force?: boolean }) => {
      const normalizedSession = normalizeSession(nextSession);
      const signature = signatureFromSession(normalizedSession);
      const hasServerCookie = normalizedSession?.access_token ? hasServerAuthSessionCookie() : true;
      if (!options?.force && signature && signature === sessionSignatureRef.current && hasServerCookie) {
        return;
      }

      sessionSignatureRef.current = signature;
      syncServerAuthSessionCookie(normalizedSession);
      setSession(normalizedSession);
      setUser(sessionToUser(normalizedSession));
      const nextAuthState = normalizedSession?.user ? 'authenticated' : 'unauthenticated';
      authStateRef.current = nextAuthState;
      setAuthState(nextAuthState);
      setIsOfflineSession(Boolean(options?.offlineBootstrap && normalizedSession?.user));
    },
    [normalizeSession, sessionToUser, signatureFromSession],
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
      void recordUserActivityRpc({
        userId,
        event: 'sign_in',
        metadata: {},
      });
    };

    const syncInitialSession = async () => {
      markAuthRestoring('useSmartAuth.bootstrap');
      const resolved = await resolveSessionFromSupabase();
      if (!mounted) return;

      applySessionState(resolved.session, {
        force: true,
        offlineBootstrap: resolved.usedCachedSession,
      });

      if (resolved.session?.user?.id) {
        recordSignIn(resolved.session.user.id);
      }
      clearAuthActionsDisabled();
    };

    void syncInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      applySessionState(session, { force: event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' });
      if (event !== 'SIGNED_OUT') {
        setIsOfflineSession(false);
      }
      if (event === 'SIGNED_IN' && session?.user?.id) {
        clearAuthActionsDisabled();
        recordSignIn(session.user.id);
      } else if (event === 'TOKEN_REFRESHED' && session?.user?.id) {
        clearAuthActionsDisabled();
      } else if (event === 'SIGNED_OUT') {
        clearAuthActionsDisabled();
      }
    });

    const handleOnline = () => {
      if (!mounted) return;
      if (authStateRef.current === 'unauthenticated' && !sessionSignatureRef.current) return;

      markAuthRestoring('useSmartAuth.online');
      void resolveSessionFromSupabase()
        .then((resolved) => {
          if (!mounted) return;
          if (!resolved.session) {
            applySessionState(null, { force: true });
            setIsOfflineSession(false);
            clearAuthActionsDisabled();
            return;
          }

          applySessionState(resolved.session, {
            force: true,
            offlineBootstrap: resolved.usedCachedSession,
          });
          if (resolved.session.user?.id) {
            clearAuthActionsDisabled();
          }
          setIsOfflineSession(resolved.usedCachedSession);
        })
        .catch(() => {
          if (!mounted) return;
          const persisted = normalizeSession(readPersistedSupabaseSession());
          if (persisted?.user) {
            applySessionState(persisted, { force: true, offlineBootstrap: true });
            clearAuthActionsDisabled();
            setIsOfflineSession(true);
            return;
          }
          applySessionState(null, { force: true });
          clearAuthActionsDisabled();
          setIsOfflineSession(false);
        });
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
  }, [applySessionState, normalizeSession, resolveSessionFromSupabase]);

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
    clearAuthActionsDisabled();
  }, [applySessionState, session?.user?.id]);

  const startReauth = useCallback((source?: string) => {
    markReauthInProgress(source || 'useSmartAuth.startReauth');
    setRuntimeAuthState('REAUTH_IN_PROGRESS');
  }, []);

  const getToken = useCallback(async () => {
    const normalizedSession = normalizeSession(session);
    if (normalizedSession?.access_token) return normalizedSession.access_token;

    const resolved = await resolveSessionFromSupabase();
    return resolved.session?.access_token ?? null;
  }, [normalizeSession, resolveSessionFromSupabase, session]);

  const isAuthed = authState === 'authenticated';
  const isLoading = authState === 'loading';
  const isAuthLocked = runtimeAuthState === 'EXPIRED' || runtimeAuthState === 'REAUTH_IN_PROGRESS';
  const isRestoringAuth = runtimeAuthState === 'RESTORING';

  const value = useMemo(
    () => ({
      user,
      session,
      authState,
      runtimeAuthState,
      isOfflineSession,
      isAuthLocked,
      isRestoringAuth,
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
      isRestoringAuth,
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
