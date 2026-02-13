'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { db, auth as firebaseAuth } from '@/lib/firebase/client';
import { signInWithCustomToken } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { supabase } from '@/lib/supabase-client/client';

/**
 * Targeted listener for direct messages sent from the Conex admin panel (via Firestore).
 * Handles Supabase -> Firebase Auth Exchange to ensure permission to read.
 */
export function DirectMessageListener({ userId, guestId }: { userId?: string; guestId?: string }) {
  const { toast } = useToast();
  const processedRef = useRef(new Set<string>());

  useEffect(() => {
    const targetId = userId || guestId;
    if (!targetId) return;

    // 1. Perform Auth Exchange (if needed)
    // We need to be signed in to Firebase as 'targetId' to read the messages securely.
    const syncAuth = async () => {
        // If already signed in with correct UID, skip
        if (firebaseAuth.currentUser?.uid === targetId) return true;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return false;

            const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-firebase-token`, {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            
            if (res.ok) {
                const { token } = await res.json();
                await signInWithCustomToken(firebaseAuth, token);
                return true;
            }
        } catch (e) {
            console.error("Auth sync failed", e);
        }
        return false;
    };

    let unsubscribe: () => void = () => {};

    syncAuth().then((success) => {
        // Even if auth fails, we try to listen (rules might allow public read or guest read if configured)
        // But mainly we rely on success for secure access.
        
        // Listen to messages for this user
        const q = query(
            collection(db, `conversations/${targetId}/messages`),
            // Removing sender_type filter to avoid index requirement. We filter in code.
            where('created_at', '>', new Date(Date.now() - 5000)), // Only recent messages on load
            orderBy('created_at', 'desc'),
            limit(5) // Increase limit slightly to ensure we catch the admin message if there are others
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    const msgId = change.doc.id;

                    // Filter for admin messages here
                    if (data.sender_type !== 'admin') return;

                    // Prevent duplicate toasts
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
             // Suppress permission errors if auth hasn't finished syncing or if user is truly blocked
             if (error.code !== 'permission-denied') {
                 console.error("Firestore listener error:", error);
             }
        });
    });

    return () => unsubscribe();
  }, [userId, guestId, toast]);

  return null;
}
