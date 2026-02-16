'use client';

import { useEffect, useRef, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth as firebaseAuth } from '@/lib/firebase/client';
import { supabase, invokeEdgeFunction } from '@/lib/supabase-client/client';
import { logOnce, runOnce } from '@/lib/log/dedupe';

export type FirebaseAuthSyncStatus = 'idle' | 'pending' | 'ready' | 'failed';

export function useFirebaseAuthSync(userId?: string | null, opts?: { onFailedOnce?: () => void }) {
  const [status, setStatus] = useState<FirebaseAuthSyncStatus>('idle');
  const [error, setError] = useState<any>(null);
  const inflightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    inflightRef.current = false;
    setError(null);

    if (!userId) {
      setStatus('idle');
      return;
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      setStatus('idle');
      return;
    }

    if (firebaseAuth.currentUser?.uid === userId) {
      setStatus('ready');
      return;
    }

    const run = async () => {
      if (inflightRef.current) return;
      if (firebaseAuth.currentUser?.uid === userId) {
        setStatus('ready');
        return;
      }

      inflightRef.current = true;
      setStatus('pending');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        inflightRef.current = false;
        setStatus('idle');
        return;
      }

      const { data, error: fnError } = await invokeEdgeFunction<{ token?: string }>('get-firebase-token', {
        requireAuth: true,
        timeoutMs: 8000,
        silent: true,
      });

      if (cancelled) return;

      if (fnError || !data?.token) {
        const code = fnError?.status;
        setError(fnError);
        inflightRef.current = false;

        if (code === 401 || code === 403) {
          logOnce('warn', 'firebase-token-unauthorized', 'Firebase token exchange unauthorized', fnError);
          setStatus('failed');
          runOnce('firebase-auth-failed-once', () => opts?.onFailedOnce?.());
          return;
        }

        setStatus('failed');
        runOnce('firebase-auth-failed-once', () => opts?.onFailedOnce?.());
        return;
      }

      try {
        await signInWithCustomToken(firebaseAuth, data.token);
        if (cancelled) return;
        setStatus('ready');
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e);
        setStatus('failed');
        logOnce('warn', 'firebase-signin-failed', 'Firebase sign-in failed', e);
        runOnce('firebase-auth-failed-once', () => opts?.onFailedOnce?.());
      } finally {
        inflightRef.current = false;
      }
    };

    run().catch((e) => {
      inflightRef.current = false;
      setStatus('failed');
      setError(e);
      logOnce('warn', 'firebase-auth-sync-unhandled', 'Firebase auth sync failed', e);
      runOnce('firebase-auth-failed-once', () => opts?.onFailedOnce?.());
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { status, error } as const;
}
