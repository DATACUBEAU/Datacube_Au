
'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { db, auth as firebaseAuth } from '@/lib/firebase/client';
import { collection, query, where, onSnapshot, orderBy, limit, addDoc, doc, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { signInWithCustomToken } from 'firebase/auth';
import { supabase, invokeEdgeFunction } from '@/lib/supabase-client/client';
import { useToast } from '@/hooks/use-toast';
import { LocalChatStorage } from '@/lib/storage/local-chat';
import { ChatMessage } from '@/lib/api/chat';
import { useFirebaseAuthSync } from '@/hooks/use-firebase-auth-sync';
import { logOnce, runOnce } from '@/lib/log/dedupe';
import { useStore } from '@/hooks/use-store';

// --- TYPES ---

interface ChatJob {
  id: string;
  threadId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  createdAt: any;
  updatedAt: any;
  error?: string;
  chat_type: 'global' | 'au_rag';
}

interface ChatRuntimeContextType {
  activeJobs: ChatJob[];
  enqueueMessage: (payload: EnqueuePayload) => Promise<void>;
  isJobPending: (threadId: string) => boolean;
  unreadCount: number;
  unreadSupport: number;
  unreadBroadcasts: number;
  markSupportRead: () => Promise<void>;
  markBroadcastsRead: () => Promise<void>;
  connectionStatus: 'connected' | 'reconnecting' | 'offline';
  firebaseAuthStatus: 'idle' | 'pending' | 'ready' | 'failed';
}

interface EnqueuePayload {
  chat_type: 'global' | 'au_rag';
  thread_id: string;
  user_input: string;
  doc_id?: string; // Required for AU
  memory_pack?: any; // Global only
  recent_snippet?: any;
}

const ChatRuntimeContext = createContext<ChatRuntimeContextType | undefined>(undefined);

export function ChatRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [user] = useSupabaseUser();
  const [activeJobs, setActiveJobs] = useState<ChatJob[]>([]);
  
  // Notification State
  const [unreadSupport, setUnreadSupport] = useState(0);
  const [unreadBroadcasts, setUnreadBroadcasts] = useState(0);
  const [activeBroadcastVersion, setActiveBroadcastVersion] = useState(0);
  const [lastSeenBroadcastVersion, setLastSeenBroadcastVersion] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('connected');
  const { toast } = useToast();
  const firebaseSyncPaused = useStore((s) => s.firebaseSyncPaused);
  const setFirebaseSyncPaused = useStore((s) => s.setFirebaseSyncPaused);
  const { status: firebaseAuthStatus } = useFirebaseAuthSync(user?.id, {
    onFailedOnce: () => {
      runOnce('firebase-auth-failed-toast', () => {
        toast({
          variant: 'destructive',
          title: 'Session expired',
          description: 'Please sign in again to view messages and notifications.',
          duration: 6000,
        });
      });
    },
  });
  const isFirebaseAuthReady = firebaseAuthStatus === 'ready';
  
  // Ref to track notified jobs to avoid double toasts
  const notifiedJobsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || firebaseSyncPaused) {
      setActiveJobs([]);
      return;
    }
  }, [user, firebaseSyncPaused]);

  // 1. Subscribe to Active Jobs (queued/processing)
  useEffect(() => {
    if (!user || !isFirebaseAuthReady || firebaseSyncPaused) {
        setActiveJobs([]);
        return;
    }

    // Query jobs that are NOT done/failed (active)
    // Firestore != query is limited, so we might query by 'status' in ['queued', 'processing']
    // Or just query last 10 jobs and filter client side.
    const jobsRef = collection(db, `users/${user.id}/jobs`);
    const q = query(
        jobsRef, 
        where('status', 'in', ['queued', 'processing']),
        orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobs: ChatJob[] = [];
      snapshot.forEach(doc => {
        jobs.push({ id: doc.id, ...doc.data() } as ChatJob);
      });
      setActiveJobs(jobs);
    }, (err) => {
      if ((err as any)?.code === 'permission-denied') {
        unsubscribe();
        logOnce('warn', 'chat-jobs-permission-denied', 'Firestore permission denied (jobs listener)', err);
        runOnce('firestore-sync-paused', () => setFirebaseSyncPaused(true, 'permission-denied'));
        return;
      }
      logOnce('warn', 'chat-jobs-listener-error', 'Firestore jobs listener error', err);
    });

    return () => unsubscribe();
  }, [user, isFirebaseAuthReady, firebaseSyncPaused, setFirebaseSyncPaused]);

  // 2. Monitor Job Completion (Notification Logic)
  useEffect(() => {
      if (!user || !isFirebaseAuthReady || firebaseSyncPaused) return;
      
      // We also need to listen to RECENTLY completed jobs to show notifications
      // Since the main listener only gets active ones, we need a separate mechanism 
      // OR we just assume if a job disappears from 'activeJobs' it *might* be done.
      // Better: Listen to all recent jobs.
      
      const jobsRef = collection(db, `users/${user.id}/jobs`);
      const q = query(jobsRef, orderBy('createdAt', 'desc'), limit(10));
      
      const unsub = onSnapshot(q, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
              if (change.type === 'modified') {
                  const job = change.doc.data() as ChatJob;
                  const jobId = change.doc.id;
                  
                  if (job.status === 'done' && !notifiedJobsRef.current.has(jobId)) {
                      // Job just finished!
                      // Check if user is currently on that thread? 
                      // We can check URL or just show a toast anyway if it was a background task.
                      // For now, simple toast.
                      
                      // Check if we are "backgrounded" from that thread
                      const isThreadOpen = window.location.pathname.includes(job.threadId); // Rough check
                      
                      if (!isThreadOpen) {
                          toast({
                              title: "Response Ready",
                              description: `New reply in ${job.chat_type === 'global' ? 'Global Chat' : 'AU Chat'}`,
                              action: <a href={job.chat_type === 'global' ? '/dashboard/global-chat' : `/dashboard/chat?id=${job.threadId}`} className="text-xs underline">View</a>
                          });
                      }
                      
                      notifiedJobsRef.current.add(jobId);
                  }
              }
          });
      }, (error) => {
        if ((error as any)?.code === 'permission-denied') {
          unsub();
          logOnce('warn', 'chat-job-completion-permission-denied', 'Firestore permission denied (job completion)', error);
          runOnce('firestore-sync-paused', () => setFirebaseSyncPaused(true, 'permission-denied'));
          return;
        }
        logOnce('warn', 'chat-job-completion-listener-error', 'Job completion listener error', error);
      });
      
      return () => unsub();
  }, [user, toast, isFirebaseAuthReady, firebaseSyncPaused, setFirebaseSyncPaused]);

  // 3. Enqueue Action
  const enqueueMessage = useCallback(async (payload: EnqueuePayload) => {
    if (!user) return;

    const { chat_type, thread_id, user_input } = payload;
    const messageId = crypto.randomUUID(); // Client-generated ID

    // A. Write User Message to Firestore (Optimistic UI)
    const msgRef = doc(db, `users/${user.id}/threads/${thread_id}/messages/${messageId}`);
    await setDoc(msgRef, {
        role: 'user',
        content: user_input,
        createdAt: serverTimestamp(),
        status: 'sent'
    });

    // B. Create Job Doc
    const jobRef = await addDoc(collection(db, `users/${user.id}/jobs`), {
        threadId: thread_id,
        messageId: messageId,
        chat_type,
        status: 'queued',
        createdAt: serverTimestamp(),
        payload: {
            // Store minimal payload for debug/retry
            len: user_input.length
        }
    });

    // C. Call Edge Function
    try {
        const { error } = await invokeEdgeFunction('enqueue-chat-job', {
            requireAuth: true,
            silent: false,
            body: {
                ...payload,
                client_message_id: messageId,
                job_id: jobRef.id
            }
        });

        if (error) throw error;
        
        // Update job status if needed (function might have already done it)
    } catch (err) {
        console.error("[ChatRuntime] Enqueue failed:", err);
        // Mark job as failed locally
        await updateDoc(jobRef, { status: 'failed', error: String(err) });
        // Mark message as failed
        await updateDoc(msgRef, { status: 'failed' });
        
        toast({ variant: 'destructive', title: "Message Failed", description: "Could not send message. Try again." });
    }

  }, [user, toast]);

  const isJobPending = useCallback((threadId: string) => {
      return activeJobs.some(j => j.threadId === threadId);
  }, [activeJobs]);

  // 4. Subscribe to Notification State & Broadcast Meta
  useEffect(() => {
      if (!user || !isFirebaseAuthReady || firebaseSyncPaused) return;

      // A. Notification State
      const notifRef = doc(db, `users/${user.id}/notification_state/inbox`);
      const unsubNotif = onSnapshot(notifRef, (doc) => {
          if (doc.exists()) {
              const data = doc.data();
              setUnreadSupport(data.unread_support || 0);
              setLastSeenBroadcastVersion(data.last_seen_broadcast_version || 0);
          } else {
              setUnreadSupport(0);
              setLastSeenBroadcastVersion(0);
          }
      }, (error) => {
          if ((error as any)?.code === 'permission-denied') {
            unsubNotif();
            logOnce('warn', 'notif-permission-denied', 'Firestore permission denied (notifications)', error);
            runOnce('firestore-sync-paused', () => setFirebaseSyncPaused(true, 'permission-denied'));
            return;
          }
          logOnce('warn', 'notif-listener-error', 'Notification listener error', error);
      });

      // B. Broadcast Meta (Global)
      const metaRef = doc(db, `broadcast_meta/current`);
      const unsubMeta = onSnapshot(metaRef, (doc) => {
          if (doc.exists()) {
              setActiveBroadcastVersion(doc.data().active_broadcast_version || 0);
          }
      }, (error) => {
          if ((error as any)?.code === 'permission-denied') {
            unsubMeta();
            logOnce('warn', 'broadcast-meta-permission-denied', 'Firestore permission denied (broadcast meta)', error);
            runOnce('firestore-sync-paused', () => setFirebaseSyncPaused(true, 'permission-denied'));
            return;
          }
          logOnce('warn', 'broadcast-meta-listener-error', 'Broadcast meta listener error', error);
      });

      return () => {
          unsubNotif();
          unsubMeta();
      };
  }, [user, isFirebaseAuthReady, firebaseSyncPaused, setFirebaseSyncPaused]);

  // Compute derived unread broadcasts
  useEffect(() => {
      const diff = activeBroadcastVersion - lastSeenBroadcastVersion;
      setUnreadBroadcasts(diff > 0 ? diff : 0);
  }, [activeBroadcastVersion, lastSeenBroadcastVersion]);

  const markSupportRead = useCallback(async () => {
      if (!user) return;
      try {
          await invokeEdgeFunction('support-mark-read', {
              requireAuth: true,
              silent: true,
              body: { viewer: 'user' }
          });
          // Optimistic update
          setUnreadSupport(0);
      } catch (err) {
          console.error("Failed to mark read:", err);
      }
  }, [user]);

  const markBroadcastsRead = useCallback(async () => {
      if (!user) return;
      if (unreadBroadcasts === 0) return; // No op

      try {
          await invokeEdgeFunction('support-mark-read', {
              requireAuth: true,
              silent: true,
              body: { viewer: 'user', scope: 'broadcasts', version: activeBroadcastVersion }
          });
          setUnreadBroadcasts(0);
      } catch (err) {
          console.error("Failed to mark broadcasts read:", err);
      }
  }, [user, unreadBroadcasts, activeBroadcastVersion]);

  return (
    <ChatRuntimeContext.Provider value={{ 
        activeJobs, 
        enqueueMessage, 
        isJobPending,
        unreadCount: unreadSupport + unreadBroadcasts,
        unreadSupport,
        unreadBroadcasts,
        markSupportRead,
        markBroadcastsRead,
        connectionStatus,
        firebaseAuthStatus
    }}>
      {children}
    </ChatRuntimeContext.Provider>
  );
}

export function useChatRuntime() {
  const context = useContext(ChatRuntimeContext);
  if (!context) {
    throw new Error('useChatRuntime must be used within a ChatRuntimeProvider');
  }
  return context;
}
