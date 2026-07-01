
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Wand2,
  Sparkles,
  ArrowRight,
  Trash2,
  ChevronDown,
  Edit2,
  Scissors,
  FileText as FileTextIcon,
  AlignLeft,
  X,
  Globe,
  Lock,
  Check,
  Copy,
  RotateCcw,
  Info,
  MessageCircle
} from 'lucide-react';
import { FeedbackSection } from "@/components/au-feedback";
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSmartAuth } from '@/hooks/use-smart-auth';
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
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { GlobalChatPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { GLOBAL_CHAT_TITLE, GLOBAL_CHAT_WELCOME_COPY } from '@shared/global-chat-routing';
import { AssistantResponseBody } from '@/components/chat/assistant-response-body';
import { ChatComposer } from '@/components/chat/chat-composer';
import { FollowUpSuggestions } from '@/components/chat/follow-up-suggestions';
import {
  buildFollowUpSuggestions,
  formatAssistantResponseText,
  formatAssistantThought,
  normalizeAssistantCitations,
} from '@/lib/chat/assistant-response';
import { describeApiErrorForUser } from '@/lib/api/user-facing-error';

const defaultGuideText = "Use this AU Guide to tell the assistant how you like to interact. For example, ask for short explanations, creative ideas, or code snippets.";
const GLOBAL_CHAT_ID = 'global';

function findPreviousUserPrompt(history: { role: 'user' | 'assistant'; content: string }[], assistantIndex: number): string {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (history[index]?.role === 'user') {
      return String(history[index]?.content || '');
    }
  }
  return '';
}

export default function GlobalChatPage() {
  const router = useRouter();
  const { enabled: isGlobalChatEnabled, loading: isFlagLoading } = useFeatureFlag('global_chat_enabled');
  
  // Removed the hardcoded redirect useEffect

  const { toast } = useToast();
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { isAuthLocked, isRestoringAuth } = useSmartAuth();
  const isOnline = useOnlineStatus();
  const canChat = isOnline && Boolean(user) && !isLoadingAuth && !isRestoringAuth && !isAuthLocked;

  // Hardcoded to 'global'
  const selectedDocId = GLOBAL_CHAT_ID;
  const selectedDocName = GLOBAL_CHAT_TITLE;

  const { 
    history: currentChatHistory, 
    setHistory: setCurrentChatHistory,
    setHistoryPersisted,
    deleteMessagePersisted,
    isResponding,
    sendMessage,
    stopGeneration
  } = useAuChat(selectedDocId);

  const {
    documents,
    refresh: refreshDocuments,
    isUsingCachedData,
    cachedAt,
  } = useAuDocuments();
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

    const shouldClearComposer = messageContent === undefined;
    if (shouldClearComposer) {
      setInput('');
    }

    // 2. Send Message via API
    try {
      await sendMessage(currentInput, {
        summaryMode: overrideMode || summaryMode,
        browsingMode,
      });
    } catch (error: any) {
      const userFacingError = describeApiErrorForUser(error, { context: 'chat' });
      console.error("[GlobalChatPage] Message error:", {
        code: userFacingError.error.code,
        status: userFacingError.error.status,
        message: userFacingError.description,
        requestId: userFacingError.requestId,
        correlationId: userFacingError.correlationId,
      });
      toast({
        variant: 'destructive',
        title: userFacingError.title,
        description: userFacingError.description,
      });
    }
  };

  const isBootLoading = isFlagLoading || isLoadingAuth;
  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(isBootLoading);

  if (isBootLoading && showSkeleton) {
    return <GlobalChatPageSkeleton />;
  }

  const composerStatusContent = (
    !isOnline ||
    ((isLoadingAuth || isRestoringAuth) && isOnline) ||
    (!isLoadingAuth && !isRestoringAuth && (!user || isAuthLocked) && isOnline)
  ) ? (
    <>
      {!isOnline ? <div>Offline mode</div> : null}
      {(isLoadingAuth || isRestoringAuth) && isOnline ? <div>Restoring session...</div> : null}
      {!isLoadingAuth && !isRestoringAuth && (!user || isAuthLocked) && isOnline ? <div>Sign in required</div> : null}
    </>
  ) : null;

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col relative">
      {showSlowNotice && isBootLoading ? <SlowNetworkNotice onRetry={() => void refreshDocuments()} /> : null}
      {isUsingCachedData && !isOnline ? (
        <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100 md:mx-8">
          Offline • showing cached context data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}.
        </div>
      ) : null}

      {/* STRICT: Always show history prompt on load */}
      {user?.id && (
        <GlobalHistoryPrompt 
          userId={user.id} 
          scope="global"
          onClearComplete={() => {
            setHistoryPersisted([]);
            toast({ title: "History Refreshed", description: "Chat interface cleared." });
          }}
        />
      )}

      <header className="flex h-auto flex-col justify-center gap-2 border-b bg-background/80 backdrop-blur-md px-4 py-3 md:h-14 md:flex-row md:items-center md:px-8 shrink-0 z-10">
        <div className="flex items-center gap-2">
           <Globe className="h-5 w-5 text-primary" />
           <h1 className="font-headline text-lg font-semibold md:text-xl">{GLOBAL_CHAT_TITLE}</h1>
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
                  <h3 className="font-headline text-xl font-semibold text-foreground mb-2">{GLOBAL_CHAT_TITLE}</h3>
                  <p className="max-w-md">{GLOBAL_CHAT_WELCOME_COPY}</p>
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
                      const sanitizedAnswer = formatAssistantResponseText(message.content);
                      const sanitizedThought = formatAssistantThought(message.thought);
                      const normalizedCitations = normalizeAssistantCitations(message.citations);
                      const followUpPrompts = buildFollowUpSuggestions({
                        answer: sanitizedAnswer,
                        userQuestion: findPreviousUserPrompt(currentChatHistory, idx),
                        documentName: selectedDocName,
                        isGlobal: true,
                      });
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
                            <AssistantResponseBody content={sanitizedAnswer} shouldAnimate={idx === currentChatHistory.length - 1 && isResponding} />
                             
                            {normalizedCitations.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                  Source
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {normalizedCitations.map((citation) => (
                                    <Badge key={citation} variant="secondary" className="rounded-full px-2.5 py-1 text-xs">
                                      {citation}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {message.navAction?.available ? (
                              <div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => router.push(message.navAction!.href)}
                                >
                                  {message.navAction.label}
                                </Button>
                              </div>
                            ) : null}

                            <FollowUpSuggestions
                              prompts={followUpPrompts}
                              disabled={isResponding}
                              onSelect={(prompt) => {
                                void handleSendMessage({ preventDefault: () => {} } as React.FormEvent, prompt);
                              }}
                            />

                            <div className="flex items-center gap-1 mt-2 opacity-50 hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" onClick={() => handleCopy(message.id, sanitizedAnswer)}>
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

      <OfflineGuard disabledReason="Offline: Global Chat unavailable">
        <ChatComposer
          textareaRef={textareaRef}
          value={input}
          onValueChange={setInput}
          onSubmit={(event) => handleSendMessage(event)}
          placeholder={
            !isOnline
              ? "Offline mode"
              : isLoadingAuth || isRestoringAuth
                ? "Restoring session..."
                : !user || isAuthLocked
                  ? "Sign in required"
                  : `Ask ${GLOBAL_CHAT_TITLE}...`
          }
          ariaLabel={`Ask ${GLOBAL_CHAT_TITLE}`}
          disabled={!canChat}
          sendDisabled={!input.trim() || !canChat}
          isResponding={isResponding}
          onStop={stopGeneration}
          topContent={(
            <AnimatePresence>
              {connectionStatus === 'reconnecting' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="mb-2 flex justify-center"
                >
                  <div className="flex items-center gap-2 rounded-full border border-yellow-200 bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800 shadow-sm">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Reconnecting...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
          statusContent={composerStatusContent}
        />
      </OfflineGuard>
      </TooltipProvider>

      {/* Clear Chat Dialog */}
     {/* i removed it */}
    </main>
  );
}
