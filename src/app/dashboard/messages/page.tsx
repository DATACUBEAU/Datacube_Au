'use client';

import { useState, useEffect, useRef } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase/client';
import { db } from '@/lib/firebase/client';
import { collection, query, where, onSnapshot, orderBy, limit, doc } from 'firebase/firestore';
import { Loader2, Bell, Inbox, Send, Reply } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useChatRuntime } from '@/components/providers/chat-runtime-provider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function MessagesPage() {
  const [user, loadingUser] = useSupabaseUser();
  const [messages, setMessages] = useState<any[]>([]);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { markSupportRead, markBroadcastsRead } = useChatRuntime();

  // Broadcast Reply State
  const [replyBroadcast, setReplyBroadcast] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
        setLoading(false);
        return;
    }

    // 1. Mark Read on Open
    markSupportRead();
    markBroadcastsRead();

    // 2. Subscribe to Support Messages
    const threadId = `support_${user.id}`;
    const msgsRef = collection(db, `support_threads/${threadId}/messages`);
    const qMsgs = query(msgsRef, orderBy('created_at', 'asc'));

    const unsubMsgs = onSnapshot(qMsgs, (snapshot) => {
        const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setMessages(msgs);
        setLoading(false);
        setTimeout(scrollToBottom, 100);
    }, (err) => {
        console.error("Firestore Msg Error:", err);
        setLoading(false);
    });

    // 3. Subscribe to Active Broadcasts
    const broadcastsRef = collection(db, 'broadcasts');
    // We can filter by 'active' == true or 'expires_at' > now
    // Firestore queries on timestamps can be tricky without composite indexes if we sort by created_at too.
    // For now, let's just fetch 'active' == true and sort client side if needed, or rely on 'active' flag management.
    // Spec: "active: boolean (optional; derived from expires_at)". 
    // Let's assume the function sets 'active: true'.
    const qBroadcasts = query(broadcastsRef, where('active', '==', true), orderBy('created_at', 'desc'));

    const unsubBroadcasts = onSnapshot(qBroadcasts, (snapshot) => {
        const br = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setBroadcasts(br);
    });

    return () => {
        unsubMsgs();
        unsubBroadcasts();
    };
  }, [user, loadingUser, markSupportRead, markBroadcastsRead]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || !user) return;
    
    setSending(true);
    try {
        const { error } = await supabase.functions.invoke('support-send', {
            body: { content: inputText }
        });

        if (error) throw error;
        setInputText('');
    } catch (e: any) {
        toast({ title: 'Failed to send', description: e.message, variant: 'destructive' });
    } finally {
        setSending(false);
    }
  };

  const handleReplyBroadcast = async () => {
      if (!replyText.trim() || !replyBroadcast) return;
      setSendingReply(true);
      try {
          const { error } = await supabase.functions.invoke('broadcast-reply', {
              body: { broadcast_id: replyBroadcast.id, content: replyText }
          });
          if (error) throw error;
          
          toast({ title: 'Reply Sent', description: 'Admin has received your reply.' });
          setReplyBroadcast(null);
          setReplyText('');
      } catch (e: any) {
          toast({ title: 'Failed to reply', description: e.message, variant: 'destructive' });
      } finally {
          setSendingReply(false);
      }
  };

  if (loadingUser || loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="container max-w-4xl py-6 h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <p className="text-muted-foreground">Direct line to Support & Updates.</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-background border rounded-xl overflow-hidden shadow-sm">
        
        {/* Chat Area */}
        <ScrollArea className="flex-1 p-4">
            <div className="flex flex-col justify-end min-h-full space-y-6 max-w-3xl mx-auto pb-4">
                
                {/* Broadcasts (Pinned Top of content, but conceptually distinct) */}
                {broadcasts.length > 0 && (
                    <div className="space-y-4 mb-8 w-full">
                        <div className="flex items-center justify-center">
                            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                                <Bell className="h-3 w-3 mr-1" /> Announcements
                            </Badge>
                        </div>
                        {broadcasts.map((b) => (
                            <div key={b.id} className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4 mx-4 shadow-sm">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-sm text-yellow-700 dark:text-yellow-400">{b.title}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-muted-foreground">
                                            {b.created_at?.seconds ? format(new Date(b.created_at.seconds * 1000), 'MMM d') : 'Now'}
                                        </span>
                                    </div>
                                </div>
                                <p className="text-sm text-foreground/90 mb-3">{b.body}</p>
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-7 text-xs text-yellow-600 hover:text-yellow-700 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                                    onClick={() => setReplyBroadcast(b)}
                                >
                                    <Reply className="h-3 w-3 mr-1" /> Reply to Admin
                                </Button>
                            </div>
                        ))}
                         <div className="flex items-center justify-center py-4">
                             <div className="h-px w-full max-w-xs bg-border/50" />
                         </div>
                    </div>
                )}

                {/* Messages Thread */}
                {messages.length === 0 ? (
                    <div className="text-center py-10 opacity-50 flex-1 flex flex-col items-center justify-center">
                        <Inbox className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p>No messages yet. Start a conversation!</p>
                    </div>
                ) : (
                    messages.map((m) => {
                        const isAdmin = m.role === 'admin';
                        return (
                            <div key={m.id} className={cn("flex w-full", isAdmin ? "justify-start" : "justify-end")}>
                                <div className={cn(
                                    "flex max-w-[75%] flex-col gap-1 rounded-2xl px-4 py-2 text-sm shadow-sm",
                                    isAdmin 
                                        ? "bg-muted rounded-tl-none" 
                                        : "bg-primary text-primary-foreground rounded-tr-none"
                                )}>
                                    {isAdmin && <span className="text-[10px] font-bold opacity-70 mb-0.5">Support</span>}
                                    <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                                    <span className={cn("text-[9px] self-end opacity-70", isAdmin ? "text-muted-foreground" : "text-primary-foreground")}>
                                        {m.created_at?.seconds ? format(new Date(m.created_at.seconds * 1000), 'h:mm a') : 'Sending...'}
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={scrollRef} />
            </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 bg-muted/30 border-t shrink-0">
            <form 
                className="max-w-3xl mx-auto flex gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                }}
            >
                <Input 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1 bg-background"
                    disabled={sending}
                />
                <Button type="submit" size="icon" disabled={sending || !inputText.trim()}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
            </form>
        </div>
      </div>

      {/* Reply Dialog */}
      <Dialog open={!!replyBroadcast} onOpenChange={(o) => !o && setReplyBroadcast(null)}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Reply to Announcement</DialogTitle>
            </DialogHeader>
            <div className="py-4">
                <p className="text-sm text-muted-foreground mb-4 border-l-2 pl-3 italic">
                    Replying to: "{replyBroadcast?.title}"
                </p>
                <Label>Your Reply</Label>
                <Textarea 
                    value={replyText} 
                    onChange={(e) => setReplyText(e.target.value)} 
                    placeholder="Write your reply to admin..."
                    className="mt-2"
                />
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={() => setReplyBroadcast(null)}>Cancel</Button>
                <Button onClick={handleReplyBroadcast} disabled={sendingReply || !replyText.trim()}>
                    {sendingReply && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send Reply
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
