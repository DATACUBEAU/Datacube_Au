'use client';

import { useEffect, useState, createContext, useContext, useMemo, useCallback, useRef } from 'react';
import { recordUserActivityRpc, resolveBrowserSession, supabase } from '@/lib/supabase-client/client';
import { Session } from '@supabase/supabase-js';
import { normalizeUsableSupabaseSession } from '@/lib/auth/browser-session';
import { clearClientAuthStorageArtifacts, clearUserScopedClientCaches, readPersistedSupabaseSession } from '@/lib/auth/session-storage';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { clearServerAuthSessionCookie, hasServerAuthSessionCookie, syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthRuntimeState,
  markAuthRestoring,
  markAuthSessionRestored,
  markAuthUnauthenticated,
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
  return normalizeUsableSupabaseSession(candidate);
}

function signatureFromBootstrapSession(nextSession: Session | null): string | null {
  if (!nextSession?.user?.id || !nextSession?.access_token) return null;
  const expires = typeof nextSession.expires_at === 'number' ? nextSession.expires_at : 0;
  return `${nextSession.user.id}:${expires}`;
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
  // Keep bootstrap session data available for rendering, but hold protected requests in a loading
  // state until the initial restore/refresh pass has settled.
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [isOfflineSession, setIsOfflineSession] = useState(
    () => Boolean(bootstrapSession?.user && typeof window !== 'undefined' && window.navigator.onLine === false),
  );
  const [runtimeAuthState, setRuntimeAuthState] = useState<AuthRuntimeState>(() => getAuthRuntimeState());
  const sessionSignatureRef = useRef<string | null>(signatureFromBootstrapSession(bootstrapSession));
  const authStateRef = useRef<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const staleAuthCleanupRef = useRef(false);

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
      const resolved = await resolveBrowserSession();
      console.log('[useSmartAuth] Resolved session from Supabase', {
        hasLiveSession: resolved.hasLiveSession,
        hasPersistedSession: resolved.hasPersistedSession,
        finalSessionSource: resolved.source,
        refreshed: resolved.refreshed,
        hasToken: !!resolved.session?.access_token,
      });
      return {
        session: normalizeSession(resolved.session),
        usedCachedSession: resolved.usedCachedSession,
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
      if (normalizedSession?.user?.id) {
        staleAuthCleanupRef.current = false;
      }
    },
    [normalizeSession, sessionToUser, signatureFromSession],
  );

  const clearStaleAuthState = useCallback(async (source: string) => {
    if (!staleAuthCleanupRef.current) {
      staleAuthCleanupRef.current = true;
      await clearUserScopedClientCaches(user?.id ?? null);
      clearClientAuthStorageArtifacts();
      clearServerAuthSessionCookie();
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Local storage/cookie cleanup above is authoritative for stale browser auth.
      }
      clearClientAuthStorageArtifacts();
      clearServerAuthSessionCookie();
    }
    markAuthUnauthenticated(source, 'session_missing');
  }, [user?.id]);

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
        markAuthSessionRestored('useSmartAuth.bootstrap');
        recordSignIn(resolved.session.user.id);
      } else {
        await clearStaleAuthState('useSmartAuth.bootstrap');
      }
    };

    void syncInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const normalizedEventSession = normalizeSession(session);
      applySessionState(normalizedEventSession, { force: event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' });
      if (event !== 'SIGNED_OUT') {
        setIsOfflineSession(false);
      }
      if (event === 'SIGNED_IN' && normalizedEventSession?.user?.id) {
        markAuthSessionRestored('useSmartAuth.authStateChange');
        recordSignIn(normalizedEventSession.user.id);
      } else if (event === 'TOKEN_REFRESHED' && normalizedEventSession?.user?.id) {
        markAuthSessionRestored('useSmartAuth.authStateChange');
      } else if (event === 'SIGNED_OUT') {
        void clearStaleAuthState('useSmartAuth.authStateChange');
      } else if (!normalizedEventSession && isOnlineNow()) {
        void clearStaleAuthState('useSmartAuth.authStateChange');
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
            void clearStaleAuthState('useSmartAuth.online');
            return;
          }

          applySessionState(resolved.session, {
            force: true,
            offlineBootstrap: resolved.usedCachedSession,
          });
          if (resolved.session.user?.id) {
            markAuthSessionRestored('useSmartAuth.online');
          }
          setIsOfflineSession(resolved.usedCachedSession);
        })
        .catch(() => {
          if (!mounted) return;
          const persisted = normalizeSession(readPersistedSupabaseSession());
          if (persisted?.user) {
            applySessionState(persisted, { force: true, offlineBootstrap: true });
            markAuthSessionRestored('useSmartAuth.online');
            setIsOfflineSession(true);
            return;
          }
          applySessionState(null, { force: true });
          void clearStaleAuthState('useSmartAuth.online');
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
  }, [applySessionState, clearStaleAuthState, isOnlineNow, normalizeSession, resolveSessionFromSupabase]);

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
    await clearStaleAuthState('useSmartAuth.signOut');
  }, [applySessionState, clearStaleAuthState, session?.user?.id]);

  const startReauth = useCallback((source?: string) => {
    markReauthInProgress(source || 'useSmartAuth.startReauth');
    setRuntimeAuthState('REAUTH_IN_PROGRESS');
  }, []);

  const getToken = useCallback(async () => {
    const normalizedSession = normalizeSession(session);
    if (normalizedSession?.access_token) {
      console.log('[useSmartAuth] getToken: using existing session token');
      return normalizedSession.access_token;
    }

    console.log('[useSmartAuth] getToken: no session token, resolving from Supabase');
    const resolved = await resolveSessionFromSupabase();
    applySessionState(resolved.session, {
      force: true,
      offlineBootstrap: resolved.usedCachedSession,
    });
    if (!resolved.session) {
      await clearStaleAuthState('useSmartAuth.getToken');
    }
    console.log('[useSmartAuth] getToken: resolved session from Supabase', {
      hasToken: !!resolved.session?.access_token,
    });
    return resolved.session?.access_token ?? null;
  }, [applySessionState, clearStaleAuthState, normalizeSession, resolveSessionFromSupabase, session]);

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
