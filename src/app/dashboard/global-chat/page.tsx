
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Wand2,
  Sparkles,
  ArrowRight,
  Send,
  Trash2,
  ChevronDown,
  Edit2,
  Scissors,
  FileText as FileTextIcon,
  AlignLeft,
  X,
  Globe,
  Lock,
  Square,
  Check,
  Copy,
  RotateCcw,
  Info,
  MessageCircle
} from 'lucide-react';
import { FeedbackSection } from "@/components/au-feedback";
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { logOnce } from '@/lib/log/dedupe';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import InteractiveConceptMap from '@/components/interactive-concept-map';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { validateQuery } from '@/lib/upload/file-types';
import { ThinkingProcess } from '@/components/thinking-process';
import { useStore } from '@/hooks/use-store';
import { useRouter } from 'next/navigation';
import { useFeatureFlag } from '@/components/feature-flag-provider';
import { GlobalHistoryPrompt } from '@/components/global-history-prompt';

import { useAuChat } from '@/hooks/api/use-au-chat';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useChatRuntime } from '@/components/providers/chat-runtime-provider';
import { OfflineGuard } from '@/components/offline-guard';

// Typing Animation Component
const TypingAnimation = ({ content, shouldAnimate = true }: { content: string, shouldAnimate?: boolean }) => {
  const [displayedContent, setDisplayedContent] = useState(shouldAnimate ? '' : content);
  const [isTyping, setIsTyping] = useState(shouldAnimate);

  useEffect(() => {
    if (!shouldAnimate) {
        setDisplayedContent(content);
        setIsTyping(false);
        return;
    }

    let i = 0;
    const interval = setInterval(() => {
      setDisplayedContent(content.slice(0, i + 1));
      i++;
      if (i >= content.length) {
        clearInterval(interval);
        setIsTyping(false);
      }
    }, 10);
    return () => clearInterval(interval);
  }, [content, shouldAnimate]);

  return (
    <div className="relative">
      <InteractiveConceptMap content={displayedContent} />
      {isTyping && (
        <span className="inline-block w-1.5 h-3.5 bg-primary ml-1 animate-pulse align-middle" />
      )}
    </div>
  );
};

const defaultGuideText = "Use this AU Guide to tell the assistant how you like to interact. For example, ask for short explanations, creative ideas, or code snippets.";
const GLOBAL_CHAT_ID = 'global';

function sanitizeAnswer(text: any) {
  const raw = typeof text === 'string' ? text : (Array.isArray(text) ? text.join('\n') : String(text ?? ''));
  // Remove [Thinking], [Retrieving] but keep citations like [1], [2]
  const withoutTags = raw.replace(/\[(?![\d, ]+\])[^\]]+\]/g, ''); 
  // Remove *** separators if they are standalone lines
  const withoutSeparators = withoutTags.replace(/^\s*\*\*\*\s*$/gm, '');
  
  const withoutSourceLines = withoutSeparators
    .split('\n')
    .filter((line) => !/^\s*source:\s*web\s*lookup\b/i.test(line))
    .join('\n');
  return withoutSourceLines.trim();
}

function sanitizeThought(text?: string) {
  const raw = text ?? '';
  const withoutInternalWords = raw.replace(
    /\b(exploratory|retrieving|retrieval|syncing|chunk(?:s)?|pipeline|lookup|document(?:s)?)\b/gi,
    ''
  );
  const normalized = withoutInternalWords.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
}

export default function GlobalChatPage() {
  const router = useRouter();
  const { enabled: isGlobalChatEnabled, loading: isFlagLoading } = useFeatureFlag('global_chat_enabled');
  
  // Removed the hardcoded redirect useEffect

  const { toast } = useToast();
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const isOnline = useOnlineStatus();
  const canChat = isOnline && !!session?.access_token && !isLoadingAuth;

  // Hardcoded to 'global'
  const selectedDocId = GLOBAL_CHAT_ID;
  const selectedDocName = "AU Global Assistant";

  const { 
    history: currentChatHistory, 
    setHistory: setCurrentChatHistory,
    setHistoryPersisted,
    deleteMessagePersisted,
    isResponding,
    sendMessage,
    stopGeneration
  } = useAuChat(selectedDocId);

  const { documents } = useAuDocuments();
  const [referencedDocId, setReferencedDocId] = useState<string | undefined>(undefined);

  // Sync AU State with Global Background Animation
  const setAuAnimationState = useStore(state => state.setAuAnimationState);
  const auAnimationState = useStore(state => state.auAnimationState);

  useEffect(() => {
    let newState: 'idle' | 'thinking' | 'responding' | 'error' = 'idle';

    if (isResponding) {
      const lastMsg = currentChatHistory[currentChatHistory.length - 1];
      if (lastMsg?.isLoading && !lastMsg.content) {
        newState = 'thinking';
      } else {
        newState = 'responding';
      }
    } else if (currentChatHistory.length > 0) {
        const lastMsg = currentChatHistory[currentChatHistory.length - 1];
        if (lastMsg.role === 'assistant' && (lastMsg.content.includes("Error") || lastMsg.content.includes("⚠️"))) {
            newState = 'error';
        }
    }

    if (auAnimationState !== newState) {
        setAuAnimationState(newState);
    }
  }, [isResponding, currentChatHistory, setAuAnimationState, auAnimationState]);

  useEffect(() => {
      return () => setAuAnimationState('idle');
  }, [setAuAnimationState]);

  const [input, setInput] = useState('');
  const [isPromptStudioOpen, setIsPromptStudioOpen] = useState(false);
  const [promptStudioInput, setPromptStudioInput] = useState('');
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideText, setGuideText] = useState(defaultGuideText);
  const [browsingMode, setBrowsingMode] = useState(true); // Enabled by default for Global

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [summaryMode, setSummaryMode] = useState<'short' | 'mid' | 'detailed' | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const handleCopy = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2000);
    toast({
      title: "Copied to clipboard",
      description: "Message content has been copied.",
    });
  };

  const handleRegenerate = async (messageId: string, mode?: 'short' | 'mid' | 'detailed') => {
    const index = currentChatHistory.findIndex(m => m.id === messageId);
    if (index <= 0) return;
    
    const userMessage = currentChatHistory[index - 1];
    if (userMessage.role !== 'user') return;
    
    const newHistory = currentChatHistory.slice(0, index);
    setHistoryPersisted(newHistory);
    
    if (mode) setSummaryMode(mode);

    handleSendMessage({ preventDefault: () => {} } as React.FormEvent, userMessage.content, mode);
  };

  const deleteMessage = (messageId: string) => {
    deleteMessagePersisted(messageId);
  };

  const handleSummaryAction = async (type: 'short' | 'mid' | 'detailed') => {
    if (isResponding) return;
    const newMode = summaryMode === type ? null : type;
    setSummaryMode(newMode);
    
    if (newMode) {
      toast({ 
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} Summary Mode Active`, 
        description: `AU will now provide ${type} responses.` 
      });
    }
  };

  // Scroll Logic
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        }
    }
  };

  const handleScroll = useCallback(() => {
      if (scrollAreaRef.current) {
          const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
              const { scrollTop, scrollHeight, clientHeight } = viewport;
              const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
              setShowScrollButton(distanceFromBottom > 100);
          }
      }
  }, []);

  useEffect(() => {
      const scrollArea = scrollAreaRef.current;
      if (scrollArea) {
          const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
              viewport.addEventListener('scroll', handleScroll);
              return () => viewport.removeEventListener('scroll', handleScroll);
          } else {
             const timer = setTimeout(() => {
                 const vp = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
                 if (vp) vp.addEventListener('scroll', handleScroll);
             }, 500);
             return () => clearTimeout(timer);
          }
      }
  }, [handleScroll]);

  // Auto-scroll on new message
  const lastHistoryLength = useRef(currentChatHistory.length);
  useEffect(() => {
    if (currentChatHistory.length > lastHistoryLength.current) {
        const lastMsg = currentChatHistory[currentChatHistory.length - 1];
        if (lastMsg?.role === 'user' || !showScrollButton) {
             requestAnimationFrame(() => scrollToBottom('smooth'));
        }
    }
    lastHistoryLength.current = currentChatHistory.length;
  }, [currentChatHistory, showScrollButton]);


  const { connectionStatus } = useChatRuntime();

  const handleSendMessage = async (e: React.FormEvent, messageContent?: string, overrideMode?: 'short' | 'mid' | 'detailed') => {
    e.preventDefault();
    const currentInput = (messageContent || input).trim();
    if (!currentInput || isResponding) return;
    if (!user) return;
    if (!canChat) {
      logOnce('warn', 'global-chat:send:blocked', '[global-chat] Send blocked (auth/online)');
      return;
    }

    const validation = validateQuery(currentInput);
    if (!validation.valid) {
      toast({ variant: 'destructive', title: 'Query Error', description: validation.error });
      return;
    }

    // 2. Send Message via API
    try {
      const res = await sendMessage(currentInput, {
        summaryMode: overrideMode || summaryMode,
        browsingMode,
        referenceDocId: referencedDocId
      });
      if (res) setInput('');
    } catch (error: any) {
      console.error("[GlobalChatPage] Message error:", error);
      // Toast is handled by useAuChat mostly, but we can keep a fallback
    }
  };

  if (isFlagLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isGlobalChatEnabled) {
    return (
      <main className="flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center relative p-4">
        <div className="max-w-md w-full space-y-8 bg-background/95 backdrop-blur-md p-8 rounded-2xl border border-primary/20 shadow-2xl">
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <motion.div
                animate={{ 
                  rotate: [0, 360],
                  scale: [1, 1.1, 1]
                }}
                transition={{ 
                  rotate: { duration: 20, repeat: Infinity, ease: "linear" },
                  scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }
                }}
              >
                <Globe className="w-8 h-8 text-primary" />
              </motion.div>
            </div>
            <h1 className="text-center font-headline text-2xl uppercase tracking-tight text-primary">
              AU Global Assistant
            </h1>
            <div className="flex items-center justify-center gap-2 py-1 px-3 rounded-full bg-primary/10 w-fit mx-auto border border-primary/20">
              <Sparkles className="h-3 w-3 text-primary animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Under Development</span>
            </div>
            <p className="text-center text-base pt-2 text-foreground/80 leading-relaxed">
              AU Global is currently being fine-tuned to provide a comprehensive study experience across <strong>all your documents at once</strong>.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-1 bg-primary/20 rounded-md p-1">
                  <Info className="h-4 w-4 text-primary" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-primary uppercase tracking-tight">What is AU Global?</h4>
                  <p className="text-sm text-muted-foreground leading-snug">
                    Unlike regular chat which focuses on one document, AU Global connects your entire library. Cross-reference facts, find overarching themes, and synthesize knowledge from every file you've uploaded.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-muted-foreground/20 bg-muted/5">
              <div className="bg-muted-foreground/10 rounded-full p-2">
                <MessageCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-foreground/80 uppercase tracking-tight">Suggestions?</h4>
                <p className="text-xs text-muted-foreground">
                  We're building this for you. Tell us what cross-document features would help you study better!
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button variant="outline" onClick={() => router.push('/dashboard')} className="flex-1 uppercase font-bold tracking-tighter">
              Close
            </Button>
            <Button 
              onClick={() => window.open('https://wa.me/2349036553377', '_blank')} 
              className="flex-1 font-bold uppercase tracking-tighter shadow-lg shadow-primary/20"
            >
              Contact Support
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col relative">
      {/* STRICT: Always show history prompt on load */}
      {user?.id && (
        <GlobalHistoryPrompt 
          userId={user.id} 
          onClearComplete={() => {
            setHistoryPersisted([]);
            toast({ title: "History Refreshed", description: "Chat interface cleared." });
          }}
        />
      )}

      {/* Global background is usually handled by layout/theme, but we can reuse AdaptiveBackground with a 'global' type if we want */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-50/50 to-purple-50/50 dark:from-indigo-950/20 dark:to-purple-950/20" />
      
      <header className="flex h-auto flex-col justify-center gap-2 border-b bg-background/80 backdrop-blur-md px-4 py-3 md:h-14 md:flex-row md:items-center md:px-8 shrink-0 z-10">
        <div className="flex items-center gap-2">
           <Globe className="h-5 w-5 text-primary" />
           <h1 className="font-headline text-lg font-semibold md:text-xl">AU Global Assistant</h1>
        </div>
        
        <div className="flex w-full flex-col gap-2 md:ml-auto md:w-auto md:flex-row md:items-center" />
      </header>

      <TooltipProvider>
        <div className="flex-1 overflow-hidden relative">
          <ScrollArea id="chat-section" className="h-full flex-1" ref={scrollAreaRef}>
            <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6">
              {currentChatHistory.length === 0 && !isResponding && (
                <div className="flex h-full flex-col items-center justify-center pt-16 text-center text-muted-foreground">
                  <div className="bg-primary/5 p-4 rounded-full mb-4">
                      <Globe className="h-10 w-10 text-primary" />
                  </div>
                  <h3 className="font-headline text-xl font-semibold text-foreground mb-2">Welcome to Global Chat</h3>
                  <p className="max-w-md">Ask me anything about current events, general knowledge, or complex topics. I can search the web to find the latest information for you.</p>
                </div>
              )}

              {currentChatHistory.map((message, idx) => (
                <div key={message.id} className="group/message relative">
                   {message.role === 'user' ? (
                    <div className="flex items-start gap-4 justify-end">
                      <div className="flex flex-col items-end gap-1 w-full max-w-[85%]">
                        <div className={`relative w-fit rounded-2xl px-4 py-2.5 text-sm bg-primary text-primary-foreground shadow-sm group-hover/message:shadow-md transition-all`}>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                        <div className="flex items-center gap-1 mt-1 opacity-50 hover:opacity-100 transition-opacity">
                           <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" onClick={() => handleCopy(message.id, message.content)}>
                             {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                           </Button>
                           <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" onClick={() => { setInput(message.content); deleteMessage(message.id); textareaRef.current?.focus(); }}>
                             <Edit2 className="h-3.5 w-3.5" />
                           </Button>
                           <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive rounded-md" onClick={() => deleteMessage(message.id)}>
                             <Trash2 className="h-3.5 w-3.5" />
                           </Button>
                         </div>
                      </div>
                    </div>
                  ) : (
                    (() => {
                      const sanitizedAnswer = sanitizeAnswer(message.content);
                      const sanitizedThought = sanitizeThought(message.thought);
                      return (
                    <div className="flex items-start gap-4">
                      <Avatar className="h-9 w-9 flex items-center justify-center bg-primary flex-shrink-0 shadow-sm">
                        <Icons.logo className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
                      </Avatar>
                      <div className="flex-1 pt-1.5 overflow-hidden">
                        {message.isLoading ? (
                          <ThinkingProcess isThinking={true} />
                        ) : (
                          <div className="space-y-4">
                            {sanitizedThought && (
                              <ThinkingProcess isThinking={false} thought={sanitizedThought} />
                            )}
                            <TypingAnimation content={sanitizedAnswer} shouldAnimate={idx === currentChatHistory.length - 1 && isResponding} />
                            
                            {message.citations && message.citations.length > 0 && (
                              <div>
                                <p className="mb-1 text-xs font-bold text-muted-foreground">SOURCE</p>
                                {message.citations.map((citation: any, i) => (
                                  <Badge key={i} variant="secondary" className="mb-1 mr-1">
                                    {typeof citation === 'string' ? citation : citation.fileName || 'Unknown Source'}
                                  </Badge>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center gap-1 mt-2 opacity-50 hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" onClick={() => handleCopy(message.id, message.content)}>
                                {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                              {idx === currentChatHistory.length - 1 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md"
                                  onClick={() => handleRegenerate(message.id)}
                                  aria-label="Regenerate response"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive rounded-md" onClick={() => deleteMessage(message.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                      );
                    })()
                  )}
                </div>
              ))}
            </div>
        </ScrollArea>
        <AnimatePresence>
            {showScrollButton && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-4 right-1/2 translate-x-1/2 z-20">
                    <Button size="icon" variant="outline" className="rounded-full shadow-lg h-8 w-8 bg-background/80 backdrop-blur-sm" onClick={() => scrollToBottom('smooth')}>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                </motion.div>
            )}
        </AnimatePresence>
      </div>

      <div className="border-t bg-background px-4 pb-4 pt-2">
        <div className="relative mx-auto max-w-4xl">
          <form onSubmit={(e) => handleSendMessage(e)} className="flex w-full items-end space-x-2">
            <div className="relative flex-1">
              <AnimatePresence>
                 {connectionStatus === 'reconnecting' && (
                    <motion.div
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, y: 10 }}
                     className="absolute bottom-full left-0 right-0 mb-2 flex justify-center"
                   >
                     <div className="flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800 border border-yellow-200 shadow-sm">
                       <Loader2 className="h-3 w-3 animate-spin" />
                       <span>Reconnecting...</span>
                     </div>
                   </motion.div>
                 )}
              </AnimatePresence>
              <Textarea
                id="message"
                ref={textareaRef}
                placeholder={
                  !isOnline
                    ? "Offline mode"
                    : !session?.access_token
                      ? "Sign in required"
                      : "Ask Global Assistant..."
                }
                className="flex-1 resize-none rounded-full border bg-secondary p-3 px-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (canChat) handleSendMessage(e);
                  }
                }}
                disabled={!canChat}
              />
              {!isOnline && (
                <div className="mt-1 pl-3 text-xs text-muted-foreground">Offline mode</div>
              )}
              {!session?.access_token && isOnline && (
                <div className="mt-1 pl-3 text-xs text-muted-foreground">Sign in required</div>
              )}
            </div>
            <OfflineGuard disabledReason="Offline: Global Chat unavailable">
            <Button type={isResponding ? "button" : "submit"} size="icon" className={`h-12 w-12 shrink-0 rounded-full transition-all ${isResponding ? 'bg-destructive' : ''}`} disabled={((!input.trim() || !canChat) && !isResponding)} onClick={(e) => { if (isResponding) { e.preventDefault(); stopGeneration(); } }}>
              {isResponding ? <div className="relative flex items-center justify-center"><Square className="h-4 w-4 fill-current" /><span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-20"></span></div> : <Send className="h-5 w-5" />}
            </Button>
            </OfflineGuard>
          </form>
        </div>
      </div>
      </TooltipProvider>

      {/* Clear Chat Dialog */}
     {/* i removed it */}
    </main>
  );
}
