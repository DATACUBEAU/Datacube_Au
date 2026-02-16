'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db, auth as firebaseAuth } from '@/lib/firebase/client';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { useFirebaseAuthSync } from '@/hooks/use-firebase-auth-sync';
import { logOnce, runOnce } from '@/lib/log/dedupe';
import { useStore } from '@/hooks/use-store';

/**
 * Targeted listener for direct messages sent from the Conex admin panel (via Firestore).
 * Handles Supabase -> Firebase Auth Exchange to ensure permission to read.
 */
export function DirectMessageListener({ userId }: { userId?: string }) {
  const { toast } = useToast();
  const processedRef = useRef(new Set<string>());
  const firebaseSyncPaused = useStore((s) => s.firebaseSyncPaused);
  const setFirebaseSyncPaused = useStore((s) => s.setFirebaseSyncPaused);
  const { status: firebaseStatus } = useFirebaseAuthSync(userId, {
    onFailedOnce: () => {
      runOnce('dm-firebase-auth-failed-toast', () => {
        toast({
          variant: 'destructive',
          title: 'Session expired',
          description: 'Please sign in again to view messages.',
          duration: 6000,
        });
      });
    },
  });

  useEffect(() => {
    const targetId = userId;
    if (!targetId) return;
    if (firebaseStatus !== 'ready') return;
    if (firebaseSyncPaused) return;

    let unsubscribe: () => void = () => {};

    const q = query(
      collection(db, `conversations/${targetId}/messages`),
      where('created_at', '>', new Date(Date.now() - 5000)),
      orderBy('created_at', 'desc'),
      limit(5)
    );

    unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          const msgId = change.doc.id;

          if (data.sender_type !== 'admin') return;
          if (processedRef.current.has(msgId)) return;
          processedRef.current.add(msgId);

          toast({
            title: 'New Message from Admin',
            description: data.content || 'You have received a new message.',
            variant: 'default',
          });
        }
      });
    }, (error) => {
      if ((error as any)?.code === 'permission-denied') {
        unsubscribe();
        logOnce('warn', 'dm-permission-denied', 'Firestore permission denied (DM)', error);
        runOnce('firestore-sync-paused', () => setFirebaseSyncPaused(true, 'permission-denied'));
        return;
      }
      logOnce('error', 'dm-listener-error', 'Firestore listener error', error);
    });

    return () => {
        if (unsubscribe) unsubscribe();
    };
  }, [userId, toast, firebaseStatus, firebaseSyncPaused, setFirebaseSyncPaused]);

  return null;
}
