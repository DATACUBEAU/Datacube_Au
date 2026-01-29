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
  MoreVertical,
  Scissors,
  FileText as FileTextIcon,
  AlignLeft,
  X,
  Globe,
  Lock,
  Square,
  Check,
  Copy,
  RotateCcw
} from 'lucide-react';
import { FeedbackSection } from "@/components/au-feedback";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { validateQuery } from '@/lib/upload/file-types';
import { ThinkingProcess } from '@/components/thinking-process';
import { useStore } from '@/hooks/use-store';

import { useAuChat } from '@/hooks/api/use-au-chat';

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
  const withoutMarkdownBold = raw.replace(/\*\*/g, '');
  const withoutBrackets = withoutMarkdownBold.replace(/[\[\]]/g, '');
  const withoutSourceLines = withoutBrackets
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
  const { toast } = useToast();
  const [user] = useSupabaseUser();
  const isOnline = useOnlineStatus();

  // Hardcoded to 'global'
  const selectedDocId = GLOBAL_CHAT_ID;
  const selectedDocName = "AU Global Assistant";

  const { 
    history: currentChatHistory, 
    setHistory: setCurrentChatHistory,
    isResponding,
    sendMessage,
    stopGeneration,
    clearChat: clearProviderChat
  } = useAuChat(selectedDocId);

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
  const [isClearChatOpen, setIsClearChatOpen] = useState(false);

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
    setCurrentChatHistory(newHistory);
    
    if (mode) setSummaryMode(mode);

    handleSendMessage({ preventDefault: () => {} } as React.FormEvent, userMessage.content, mode);
  };

  const clearChat = () => {
    clearProviderChat();
    toast({ title: "Hot Reload", description: "Reloading to clear all states..." });
    setTimeout(() => {
        window.location.reload();
    }, 500);
  };

  const deleteMessage = (messageId: string) => {
    setCurrentChatHistory(prev => prev.filter(m => m.id !== messageId));
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


  const handleSendMessage = async (e: React.FormEvent, messageContent?: string, overrideMode?: 'short' | 'mid' | 'detailed') => {
    e.preventDefault();
    const currentInput = (messageContent || input).trim();
    if (!currentInput || isResponding) return;
    if (!user) return;

    const validation = validateQuery(currentInput);
    if (!validation.valid) {
      toast({ variant: 'destructive', title: 'Query Error', description: validation.error });
      return;
    }

    setInput('');

    try {
      await sendMessage(currentInput, {
        guide: guideText !== defaultGuideText ? guideText : undefined,
        browsingMode: browsingMode // Use state (true by default for global)
      });
    } catch (error: any) {
      console.error("[GlobalChatPage] Message error:", error);
      toast({
        variant: 'destructive',
        title: 'AU Chat Issue',
        description: "Error communicating with AU Global.",
      });
    }
  };

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col relative">
      {/* Global background is usually handled by layout/theme, but we can reuse AdaptiveBackground with a 'global' type if we want */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-50/50 to-purple-50/50 dark:from-indigo-950/20 dark:to-purple-950/20" />
      
      <header className="flex h-auto flex-col justify-center gap-2 border-b bg-background/80 backdrop-blur-md px-4 py-3 md:h-14 md:flex-row md:items-center md:px-8 shrink-0 z-10">
        <div className="flex items-center gap-2">
           <Globe className="h-5 w-5 text-primary" />
           <h1 className="font-headline text-lg font-semibold md:text-xl">AU Global Assistant</h1>
        </div>
        
        <div className="flex w-full flex-col gap-2 md:ml-auto md:w-auto md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-10 w-10 transition-all duration-300 ${browsingMode ? 'text-blue-500 bg-blue-50 hover:bg-blue-100' : 'text-muted-foreground hover:text-primary'}`}
                  onClick={() => {
                      setBrowsingMode(!browsingMode);
                      toast({ title: !browsingMode ? "Browsing Enabled" : "Browsing Disabled", description: !browsingMode ? "AU can search the web." : "AU is restricted to general knowledge." });
                  }}
                >
                  {browsingMode ? <Globe className="h-5 w-5" /> : <Globe className="h-5 w-5 opacity-50" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{browsingMode ? "Disable Internet Browsing" : "Enable Internet Browsing"}</p>
              </TooltipContent>
            </Tooltip>
            </TooltipProvider>
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" className="h-10 w-10">
      <MoreVertical className="h-5 w-5" />
    </Button>
  </DropdownMenuTrigger>

  <DropdownMenuContent align="end">
    <DropdownMenuItem
      className="text-destructive"
      onClick={clearChat}
    >
      <Trash2 className="mr-2 h-4 w-4" />
      Clear Chat History
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

          </div>
        </div>
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
              <Textarea
                id="message"
                ref={textareaRef}
                placeholder={!isOnline ? "You are offline." : "Ask Global Assistant..."}
                className="flex-1 resize-none rounded-full border bg-secondary p-3 px-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
                disabled={!isOnline}
              />
            </div>
            <Button type={isResponding ? "button" : "submit"} size="icon" className={`h-12 w-12 shrink-0 rounded-full transition-all ${isResponding ? 'bg-destructive' : ''}`} disabled={(!input.trim() || !isOnline) && !isResponding} onClick={(e) => { if (isResponding) { e.preventDefault(); stopGeneration(); } }}>
              {isResponding ? <div className="relative flex items-center justify-center"><Square className="h-4 w-4 fill-current" /><span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-20"></span></div> : <Send className="h-5 w-5" />}
            </Button>
          </form>
        </div>
      </div>
      </TooltipProvider>

      {/* Clear Chat Dialog */}
     {/* i removed it */}
    </main>
  );
}
