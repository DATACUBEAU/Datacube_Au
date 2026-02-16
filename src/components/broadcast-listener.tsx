'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Info, Sparkles, Megaphone, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase, invokeEdgeFunction } from '@/lib/supabase-client/client';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useFirebaseAuthSync } from '@/hooks/use-firebase-auth-sync';
import { logOnce, runOnce } from '@/lib/log/dedupe';
import { useStore } from '@/hooks/use-store';

interface BroadcastMessage {
  id: string;
  title: string;
  content: string;
  expires_at?: string;
}

type PopupMessage = {
  id: string;
  title: string;
  content: string;
  expires_at?: string | null;
  user_id?: string | null;
  is_read?: boolean;
};

const toPopupMessage = (val: unknown): PopupMessage | null => {
  if (!val || typeof val !== 'object') return null;
  const v = val as Record<string, unknown>;
  if (typeof v.title !== 'string') return null;
  if (typeof v.content !== 'string') return null;
  return v as PopupMessage;
};

export function BroadcastListener() {
  const [user] = useSupabaseUser();
  const [message, setMessage] = useState<PopupMessage | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();
  const firebaseSyncPaused = useStore((s) => s.firebaseSyncPaused);
  const setFirebaseSyncPaused = useStore((s) => s.setFirebaseSyncPaused);
  const { status: firebaseStatus } = useFirebaseAuthSync(user?.id, {
    onFailedOnce: () => {
      runOnce('broadcast-firebase-auth-failed-toast', () => {
        toast({
          variant: 'destructive',
          title: 'Session expired',
          description: 'Please sign in again to view announcements.',
          duration: 6000,
        });
      });
    },
  });

  const handleSendReply = async () => {
    if (!reply.trim() || !message) return;
    setIsSending(true);
    try {
      const { error } = await invokeEdgeFunction('broadcast-reply', {
        requireAuth: true,
        silent: false,
        body: {
          broadcast_id: message.id,
          content: reply,
        },
      });

      if (error) throw error;

      toast({ title: 'Reply Sent', description: 'Admin will see your message.' });
      setReply('');
      handleDismiss();
    } catch (e: any) {
      logOnce('error', 'broadcast-reply-failed', 'Broadcast reply failed', e);
      toast({ title: 'Error', description: e?.message || "Failed to send reply", variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    if (firebaseStatus !== 'ready') return;
    if (firebaseSyncPaused) return;

    const qBroadcast = query(
      collection(db, 'broadcasts'), 
      orderBy('created_at', 'desc'), 
      limit(1)
    );

    const unsubBroadcast = onSnapshot(qBroadcast, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const d = change.doc.data();
          const msg: PopupMessage = {
            id: change.doc.id,
            title: d.title || 'Announcement',
            content: d.content || '',
            expires_at: d.expires_at || null
          };

          if (msg.expires_at && new Date(msg.expires_at) < new Date()) return;
          if (sessionStorage.getItem(`au_msg_seen_${msg.id}`)) return;

          setMessage(msg);
          setIsVisible(true);
        }
      });
    }, (error) => {
      if ((error as any)?.code === 'permission-denied') {
        unsubBroadcast();
        logOnce('warn', 'broadcast-listener-permission-denied', 'Firestore permission denied (broadcast listener)', error);
        runOnce('firestore-sync-paused', () => setFirebaseSyncPaused(true, 'permission-denied'));
        return;
      }
      logOnce('warn', 'broadcast-listener-error', 'Broadcast listener error', error);
    });

    const threadId = `support_${user.id}`;
    const qDM = query(
      collection(db, `support_threads/${threadId}/messages`),
      where('role', '==', 'admin'),
      orderBy('created_at', 'desc'),
      limit(1)
    );

    const unsubDM = onSnapshot(qDM, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const d = change.doc.data();
          if (sessionStorage.getItem(`au_msg_seen_${change.doc.id}`)) return;

          const msg: PopupMessage = {
            id: change.doc.id,
            title: 'Support Message',
            content: d.content || '',
            expires_at: null,
            is_read: false,
          };

          setMessage(msg);
          setIsVisible(true);
          toast({ title: "New Message", description: "You have a new message from Support." });
        }
      });
    }, (error) => {
      if ((error as any)?.code === 'permission-denied') {
        unsubDM();
        logOnce('warn', 'broadcast-dm-permission-denied', 'Firestore permission denied (broadcast DM)', error);
        runOnce('firestore-sync-paused', () => setFirebaseSyncPaused(true, 'permission-denied'));
        return;
      }
      logOnce('warn', 'broadcast-dm-listener-error', 'DM listener error', error);
    });

    return () => {
      unsubBroadcast();
      unsubDM();
    };
  }, [toast, user?.id, firebaseStatus, firebaseSyncPaused, setFirebaseSyncPaused]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (message && message.expires_at && new Date(message.expires_at) < new Date()) {
        handleDismiss();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [message]);

  const handleDismiss = async () => {
    if (message) {
      sessionStorage.setItem(`au_msg_seen_${message.id}`, 'true');
    }
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && message && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
        >
          <motion.div 
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-2xl"
            layoutId="broadcast-card"
          >
            <div className="relative p-6 md:p-8">
              {/* Background Accent */}
              <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
              <div className="absolute -left-12 -bottom-12 h-48 w-48 rounded-full bg-primary/5 blur-3xl" />

              <button 
                onClick={handleDismiss}
                className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex flex-col items-center text-center gap-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-8 ring-primary/5">
                  <Megaphone className="h-8 w-8 text-primary" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-2xl font-headline font-bold uppercase tracking-tight text-primary">
                    {message.title}
                  </h3>
                  <div className="h-1 w-12 bg-primary/30 mx-auto rounded-full" />
                </div>

                <p className="text-lg text-foreground/90 leading-relaxed font-medium">
                  {message.content}
                </p>

                <div className="w-full space-y-3 pt-2">
                  <div className="flex gap-2">
                    <Input 
                      placeholder="Type a reply..." 
                      value={reply} 
                      onChange={(e) => setReply(e.target.value)}
                      className="flex-1 bg-muted/50 border-primary/10 focus-visible:ring-primary"
                      onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                    />
                    <Button 
                      size="icon" 
                      onClick={handleSendReply} 
                      disabled={isSending || !reply.trim()}
                      className="shrink-0"
                    >
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                  
                  <Button 
                    variant="ghost"
                    onClick={handleDismiss}
                    className="w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Dismiss without replying
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
