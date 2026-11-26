'use client';

import { useEffect, useState, createContext, useContext, useMemo, useCallback, useRef } from 'react';
import { recordUserActivityRpc, resolveBrowserSession, supabase } from '@/lib/supabase-client/client';
import { Session } from '@supabase/supabase-js';
import { normalizeUsableSupabaseSession } from '@/lib/auth/browser-session';
import { clearClientAuthStorageArtifacts, clearUserScopedClientCaches, readPersistedSupabaseSession } from '@/lib/auth/session-storage';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { CANONICAL_WEBSITE_ORIGIN, isMobileAuthorizationDestination, sanitizeLocalRedirectPath, saveMobileOAuthDestination } from '@/lib/auth/redirects';
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

function isAuthDebugEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DCAU_AUTH_DEBUG === '1';
}

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
  const staleAuthCleanupTaskRef = useRef<Promise<void> | null>(null);
  const oauthStartingRef = useRef(false);

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
      if (isAuthDebugEnabled()) {
        console.info('[useSmartAuth] Resolved session from Supabase', {
          hasLiveSession: resolved.hasLiveSession,
          hasPersistedSession: resolved.hasPersistedSession,
          finalSessionSource: resolved.source,
          refreshed: resolved.refreshed,
          hasToken: !!resolved.session?.access_token,
        });
      }
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
    const oauthActive = () => oauthStartingRef.current || (
      typeof window !== 'undefined' && window.location.pathname === '/auth/callback'
      && new URLSearchParams(window.location.search).has('code')
    );
    const freshSession = () => Boolean(sessionSignatureRef.current && authStateRef.current === 'authenticated');

    if (freshSession()) {
      staleAuthCleanupRef.current = false;
      markAuthSessionRestored(`${source}:fresh_session_detected`);
      return;
    }
    // Both OAuth initiation and callback exchange own the PKCE verifier.
    // A background INITIAL_SESSION(null) / SIGNED_OUT must not remove it.
    if (oauthActive()) {
      markAuthRestoring(`${source}:oauth_callback`);
      return;
    }
    if (staleAuthCleanupTaskRef.current) {
      await staleAuthCleanupTaskRef.current;
      return;
    }
    if (!staleAuthCleanupRef.current) {
      staleAuthCleanupRef.current = true;
      const task = (async () => {
        await clearUserScopedClientCaches(user?.id ?? null);
        if (oauthActive() || freshSession()) return;
        clearClientAuthStorageArtifacts();
        clearServerAuthSessionCookie();
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          // Local storage/cookie cleanup above is authoritative for stale browser auth.
        }
        if (oauthActive() || freshSession()) return;
        clearClientAuthStorageArtifacts();
        clearServerAuthSessionCookie();
      })();
      staleAuthCleanupTaskRef.current = task;
      try {
        await task;
      } finally {
        if (staleAuthCleanupTaskRef.current === task) staleAuthCleanupTaskRef.current = null;
      }
    }
    if (!oauthActive() && !freshSession()) markAuthUnauthenticated(source, 'session_missing');
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
      // The callback owns the exchange; avoid applying an earlier null snapshot
      // over the SIGNED_IN event produced by the successful exchange.
      if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback'
        && new URLSearchParams(window.location.search).has('code')) return;
      const resolved = await resolveSessionFromSupabase();
      if (!mounted || oauthStartingRef.current) return;

      applySessionState(resolved.session, {
        force: true,
        offlineBootstrap: resolved.usedCachedSession,
      });

      if (resolved.session?.user?.id) {
        markAuthSessionRestored('useSmartAuth.bootstrap');
        recordSignIn(resolved.session.user.id);
      } else if (
        typeof window !== 'undefined' &&
        window.location.pathname.startsWith('/auth/callback') &&
        (window.location.search.includes('code=') || window.location.search.includes('error='))
      ) {
        markAuthRestoring('useSmartAuth.bootstrap:auth-callback');
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
    if (oauthStartingRef.current) return;
    oauthStartingRef.current = true;
    authStateRef.current = 'loading';
    setAuthState('loading');
    const safePath = sanitizeLocalRedirectPath(redirectPath, '/');
    let redirectTo: string | undefined;
    try {
      // Drain any cleanup already started before generating a fresh verifier.
      await staleAuthCleanupTaskRef.current;
      if (typeof window !== 'undefined') {
        const mobile = isMobileAuthorizationDestination(safePath);
        // Move before creating a PKCE verifier: storage is scoped to the origin.
        if (window.location.hostname === 'datacube-au.vercel.app') {
          const canonicalLogin = new URL('/login', CANONICAL_WEBSITE_ORIGIN);
          canonicalLogin.searchParams.set('redirectTo', safePath);
          if (mobile) canonicalLogin.searchParams.set('forceReauth', '1');
          window.location.assign(canonicalLogin.toString());
          return;
        }
        // The mobile destination stays in the initiating browser tab. A fixed
        // callback can be allow-listed exactly, without per-request query values.
        // If storage fails, do not start a mobile OAuth transaction we cannot resume.
        try {
          saveMobileOAuthDestination(window.sessionStorage, safePath);
        } catch (error) {
          if (mobile) throw error;
        }
        redirectTo = mobile
          ? `${window.location.origin}/auth/callback`
          : `${window.location.origin}/auth/callback?next=${encodeURIComponent(safePath)}`;
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
    } catch (error) {
      oauthStartingRef.current = false;
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
      if (isAuthDebugEnabled()) {
        console.info('[useSmartAuth] getToken: using existing session token');
      }
      return normalizedSession.access_token;
    }

    if (isAuthDebugEnabled()) {
      console.info('[useSmartAuth] getToken: no session token, resolving from Supabase');
    }
    const resolved = await resolveSessionFromSupabase();
    applySessionState(resolved.session, {
      force: true,
      offlineBootstrap: resolved.usedCachedSession,
    });
    if (!resolved.session) {
      await clearStaleAuthState('useSmartAuth.getToken');
    }
    if (isAuthDebugEnabled()) {
      console.info('[useSmartAuth] getToken: resolved session from Supabase', {
        hasToken: !!resolved.session?.access_token,
      });
    }
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
