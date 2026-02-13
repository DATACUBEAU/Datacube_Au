'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Info, Sparkles, Megaphone, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase-client/client';
import { decodeJWT, ensureGuestSession, getGuestToken } from '@/lib/supabase-client/client';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

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
  guest_session_id?: string | null;
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
  const [message, setMessage] = useState<PopupMessage | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();

  const handleSendReply = async () => {
    if (!reply.trim() || !message) return;
    setIsSending(true);
    try {
      // Use Edge Function for Reply (Secure)
      const { error } = await supabase.functions.invoke('broadcast-reply', {
        body: {
          broadcastId: message.id, // Or parent message ID if this is a thread
          content: reply,
          // The edge function will handle user/guest identification via token
        }
      });

      if (error) throw error;

      toast({ title: 'Reply Sent', description: 'Admin will see your message.' });
      setReply('');
      handleDismiss();
    } catch (e: any) {
      console.error('Reply failed:', e);
      toast({ title: 'Error', description: e.message || "Failed to send reply", variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    // 1. Broadcast Listener (Firestore)
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
      console.warn("Broadcast listener error:", error);
    });

    // 2. Direct Message Listener (Firestore)
    let unsubDM: (() => void) | undefined;

    const setupDmListener = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      let guestId: string | undefined;
      const guestToken = getGuestToken();
      if (guestToken) {
        const decoded = decodeJWT(guestToken);
        guestId = decoded?.guest_session_id || decoded?.sub;
      }

      const targetId = userId || guestId;
      if (!targetId) return;

      const threadId = `support_${targetId}`;
      const qDM = query(
        collection(db, `support_threads/${threadId}/messages`),
        where('role', '==', 'admin'), // Only show admin messages
        orderBy('created_at', 'desc'),
        limit(1)
      );

      unsubDM = onSnapshot(qDM, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const d = change.doc.data();
            // Avoid showing old messages on reload (optional, but good UX)
            // For now, simple logic: if it's new to the listener, show it.
            // Better: Check timestamp vs now, or use a "read" flag on client.
            
            // Simple dedupe via session storage
            if (sessionStorage.getItem(`au_msg_seen_${change.doc.id}`)) return;

            const msg: PopupMessage = {
              id: change.doc.id,
              title: 'Support Message',
              content: d.content || '',
              expires_at: null,
              is_read: false
            };

            setMessage(msg);
            setIsVisible(true);
            toast({ title: "New Message", description: "You have a new message from Support." });
          }
        });
      }, (error) => {
        // Suppress permission denied errors if auth is still syncing
        if (error.code !== 'permission-denied') {
           console.warn("DM listener error:", error);
        }
      });
    };

    setupDmListener().catch(console.error);

    return () => {
      unsubBroadcast();
      if (unsubDM) unsubDM();
    };
  }, [toast]);

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
