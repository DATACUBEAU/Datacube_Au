'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Wand2,
  Sparkles,
  ArrowRight,
  Send,
  Lightbulb,
  Info,
  Trash2,
  ChevronDown,
  ChevronUp,
  Edit2,
  MoreVertical,
  Scissors,
  FileText as FileTextIcon,
  AlignLeft,
  ChevronRight,
  X,
  Search,
  BookOpen,
  MessageSquare,
  HelpCircle,
  Plus,
  History,
  Brain,
  Quote,
  Copy,
  RotateCcw,
  Check,
  Lock,
  Square
} from 'lucide-react';
import { FeedbackSection } from "@/components/au-feedback";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
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
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import type { RagBasedQuestionAnsweringOutput } from '@/app/actions';
import InteractiveConceptMap from '@/components/interactive-concept-map';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import type { AuDocumentRow } from '@/lib/au/types';
import { getAuDocumentChunksText, listAuDocumentsForUser } from '@/lib/au/documents';
import { safeFetch } from '@/lib/api/safe-fetch';
import { validateQuery } from '@/lib/upload/file-types';
import { TruncatedText } from '@/components/TruncatedText';
import { ThinkingProcess } from '@/components/thinking-process';

import { type ChatMessage } from '@/lib/api/chat';

// Add TypingAnimation component
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

const defaultGuideText =
  "Use this AU Guide to tell the assistant how you like to study. For example, ask for short step-by-step explanations, exam-focused answers, or extra context. You can edit this text any time and AU will follow it when answering your questions.";

import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { useAuChat } from '@/hooks/api/use-au-chat';
import { getDocumentText } from '@/lib/api/documents';

export default function ChatPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const isOnline = useOnlineStatus();

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const { documents: apiDocuments, loading: docsLoading } = useAuDocuments();
  const { 
    history: currentChatHistory, 
    setHistory: setCurrentChatHistory,
    isResponding,
    sendMessage,
    stopGeneration,
    scanAndGreet,
    fetchPrompts,
    promptStarters,
    guide: dbGuide,
    summaryMode: dbSummaryMode,
    hasGreeted,
    updateMetadata,
    clearHistory,
    draftInput: dbDraftInput,
    scrollPosition: dbScrollPos,
  } = useAuChat(selectedDocId);

  // Background Notification Logic
  useEffect(() => {
     // If the user switches back, we can check for new updates
     if (hasGreeted && !isResponding) {
         // Notification logic can be implemented here if needed
     }
  }, [selectedDocId, isResponding, hasGreeted]);

  const documentList = useMemo(() => apiDocuments
    .filter(d => d.document_type === 'main_textbook')
    .map(d => ({ 
      id: d.id, 
      fileName: d.file_name, 
      status: d.status,
      type: d.document_type 
    })),
    [apiDocuments]
  );

  const [isSwitchingDocs, setIsSwitchingDocs] = useState(false);
  const [isPromptStudioOpen, setIsPromptStudioOpen] = useState(false);
  const [promptStudioInput, setPromptStudioInput] = useState('');
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingPrompts, setIsFetchingPrompts] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isClearChatOpen, setIsClearChatOpen] = useState(false);

  // --- First-Time Engagement Logic ---
  const greetingAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (selectedDocId && user && !isResponding && !isFetchingPrompts && !isSwitchingDocs) {
        // Prevent loop: Check if we already attempted this session
        if (greetingAttemptedRef.current.has(selectedDocId)) return;

        // If not greeted AND chat history is empty (real first time), trigger greeting
        if (!hasGreeted && currentChatHistory.length === 0) {
             console.log(`[AU Chat] First time seeing ${selectedDocId}, initiating scan...`);
             
             // Mark as attempted immediately to prevent loop
             greetingAttemptedRef.current.add(selectedDocId);
             updateMetadata({ hasGreeted: true });

             scanAndGreet().catch(err => {
                 console.error("[AU Chat] Greeting failed", err);
             });
        }
    }
  }, [selectedDocId, user, isResponding, isFetchingPrompts, isSwitchingDocs, currentChatHistory.length, scanAndGreet, hasGreeted, updateMetadata]);

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
    
    if (mode) {
      setSummaryMode(mode);
      // Small delay to ensure state update if we were relying on it, 
      // but we will pass it explicitly to handleSendMessage
    }

    handleSendMessage({ preventDefault: () => {} } as React.FormEvent, userMessage.content, mode);
  };

  const handleToggleSummary = (mode: 'short' | 'mid' | 'detailed') => {
    setSummaryMode(prev => prev === mode ? null : mode);
  };

  const clearChat = async () => {
    // 1. Stop any active generation
    if (isResponding) {
      stopGeneration();
    }

    // 2. Clear state in hook (handles DB)
    await clearHistory();
    
    toast({ 
      title: "Workspace Refreshed", 
      description: "Chat history and state have been reset for stability.",
      duration: 2000
    });

    // Hard reload for stability (optional, but keep for now if requested by previous logic)
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const deleteMessage = (messageId: string) => {
    setCurrentChatHistory(prev => prev.filter(m => m.id !== messageId));
  };

  const editMessage = (messageId: string, newContent: string) => {
    setCurrentChatHistory(prev => prev.map(m => m.id === messageId ? { ...m, content: newContent } : m));
  };

  const handleSummaryAction = async (type: 'short' | 'mid' | 'detailed') => {
    if (!selectedDocId || isResponding) return;
    const newMode = dbSummaryMode === type ? null : type;
    updateMetadata({ summaryMode: newMode });
    
    if (newMode) {
      toast({ 
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} Summary Mode Active`, 
        description: `AU will now provide ${type} responses. Click again to disable.` 
      });
    }
  };
  const selectedDoc = useMemo(() => documentList.find(doc => doc.id === selectedDocId), [documentList, selectedDocId]);
  const selectedDocName = useMemo(() => selectedDoc?.fileName, [selectedDoc]);

  const getDocumentContent = useCallback(async (docId: string): Promise<string> => {
    if (!user) return '';
    return getDocumentText(user, docId);
  }, [user]);

  const guideText = dbGuide || defaultGuideText;
  const input = dbDraftInput || '';
  const setInput = (val: string) => updateMetadata({ draftInput: val });
  const setGuideText = (val: string) => updateMetadata({ guide: val });
  const summaryMode = dbSummaryMode;
  const setSummaryMode = (val: any) => updateMetadata({ summaryMode: val });

  // Cleanup logic for "stuck" loading states
  useEffect(() => {
      const stuckMessages = currentChatHistory.filter(m => m.isLoading && !isResponding);
      if (stuckMessages.length > 0) {
           setCurrentChatHistory(prev => prev.map(m => (m.isLoading && !isResponding) ? { ...m, isLoading: false, content: m.content || "⚠️ Generation interrupted." } : m));
      }
  }, [currentChatHistory, isResponding, setCurrentChatHistory]);

  useEffect(() => {
    if (selectedDocId && !docsLoading && apiDocuments.length > 0) {
      const exists = apiDocuments.some(d => d.id === selectedDocId);
      if (!exists) {
        console.log(`[ChatPage] Selected document ${selectedDocId} no longer exists. Resetting...`);
        setSelectedDocId(null);
        setCurrentChatHistory([]);
      }
    }
  }, [apiDocuments, selectedDocId, docsLoading, setCurrentChatHistory]);

  const handleDocSelection = (newSelectedId: string | null) => {
    if (newSelectedId && newSelectedId !== selectedDocId) {
      // Navigate to the new document URL
      router.push(`/dashboard/chat?docId=${newSelectedId}`, { scroll: false });
    }
  };

  // Sync URL docId with local state
  useEffect(() => {
    const docId = searchParams.get('docId');
    if (docId && docId !== selectedDocId) {
      // Stop any active generation
      if (isResponding) stopGeneration();
      
      setSelectedDocId(docId);
      setCurrentChatHistory([]);
    }
  }, [searchParams, selectedDocId, isResponding, stopGeneration, setCurrentChatHistory]);

  useEffect(() => {
    if (docsLoading || !user) return;

    if (documentList.length > 0) {
        const docIds = documentList.map(doc => doc.id);
        if (!selectedDocId || !docIds.includes(selectedDocId)) {
            handleDocSelection(docIds[0]);
        }
    } else {
        handleDocSelection(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentList, docsLoading, user]);

  // Scroll position logic
  const lastScrollPos = useRef<number>(0);
  const isInitialLoad = useRef(true);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        }
    }
  };

  const saveScrollPosition = useCallback(() => {
    if (scrollAreaRef.current && user && selectedDocId) {
       const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
       if (viewport) {
           updateMetadata({ scrollPosition: viewport.scrollTop });
       }
    }
  }, [user, selectedDocId, updateMetadata]);

  const restoreScrollPosition = useCallback(() => {
      if (scrollAreaRef.current && user && selectedDocId) {
          const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport && dbScrollPos) {
              viewport.scrollTop = dbScrollPos;
          } else if (viewport) {
              // Default to bottom if no saved pos
              viewport.scrollTop = viewport.scrollHeight;
          }
      }
  }, [user, selectedDocId, dbScrollPos]);

  // Auto-scroll logic:
  // 1. When a new message is added (length changes), scroll to bottom ONLY if user is already near bottom.
  // 2. Unless it's the very first load, then restore position.
  const lastHistoryLength = useRef(currentChatHistory.length);
  
  useEffect(() => {
    const isNewMessage = currentChatHistory.length > lastHistoryLength.current;
    const isInitial = isInitialLoad.current;
    
    if (isInitial && currentChatHistory.length > 0) {
        // First load: restore position
        // We need a slight delay for layout to settle
        setTimeout(() => {
            restoreScrollPosition();
            isInitialLoad.current = false;
        }, 100);
    } else if (isNewMessage) {
        // New message arrived
        // If user sent it (last message is user), force scroll
        const lastMsg = currentChatHistory[currentChatHistory.length - 1];
        if (lastMsg?.role === 'user') {
             requestAnimationFrame(() => scrollToBottom('smooth'));
        } else if (!showScrollButton) {
             // If AI sent it and we are near bottom, scroll
             requestAnimationFrame(() => scrollToBottom('smooth'));
        }
        // If AI sent it and we are scrolled up (showScrollButton is true), do NOT scroll. 
        // Instead, show "New Message" indicator (which we already have via showScrollButton logic mostly)
    }

    lastHistoryLength.current = currentChatHistory.length;
  }, [currentChatHistory, showScrollButton, restoreScrollPosition]);

  const handleScroll = useCallback(() => {
      if (scrollAreaRef.current) {
          const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
              const { scrollTop, scrollHeight, clientHeight } = viewport;
              const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
              setShowScrollButton(distanceFromBottom > 100); // Show button if >100px from bottom
              
              // Save scroll position periodically or on end
              lastScrollPos.current = scrollTop;
          }
      }
  }, []);

  // Save scroll on unmount or doc switch
  useEffect(() => {
      return () => {
          if (user && selectedDocId && lastScrollPos.current > 0) {
              updateMetadata({ scrollPosition: lastScrollPos.current });
          }
      };
  }, [user, selectedDocId, updateMetadata]);

  useEffect(() => {
      const scrollArea = scrollAreaRef.current;
      if (scrollArea) {
          const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
              viewport.addEventListener('scroll', handleScroll);
              return () => viewport.removeEventListener('scroll', handleScroll);
          } else {
             // Retry once if viewport isn't ready immediately (e.g. hydration)
             const timer = setTimeout(() => {
                 const vp = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
                 if (vp) vp.addEventListener('scroll', handleScroll);
             }, 500);
             return () => clearTimeout(timer);
          }
      }
  }, [handleScroll]);

  const fetchPromptStarters = useCallback(async () => {
    if (!selectedDocId || !selectedDocName || !user || !isOnline || isFetchingPrompts) return;
    setIsFetchingPrompts(true);
    try {
      const documentContent = await getDocumentContent(selectedDocId);
      if (!documentContent) return;
      
      await fetchPrompts(selectedDocName, documentContent);
    } catch (error) {
      console.warn("[fetchPromptStarters] Failed to generate prompts", error);
    } finally {
      setIsFetchingPrompts(false);
    }
  }, [selectedDocId, selectedDocName, user, getDocumentContent, isOnline, isFetchingPrompts, fetchPrompts]);

  useEffect(() => {
    if (!selectedDocId || !user) return;
    
    if (isOnline && promptStarters.length === 0 && currentChatHistory.length > 0) {
      fetchPromptStarters();
    }
  }, [selectedDocId, user, isOnline, fetchPromptStarters, promptStarters.length, currentChatHistory.length]);

  const handleEnhancePrompt = async () => {
    if (!promptStudioInput.trim() || !selectedDocId || isGenerating || !user) return;
    
    setIsGenerating(true);
    setGeneratedPrompts([]);
    
    // Close dialog if open, since we'll show them under the chat
    setIsPromptStudioOpen(false);

    try {
      const documentContent = await getDocumentContent(selectedDocId);
      const documentTitle = selectedDocName || 'Current Document';

      const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

      const result = await safeFetch(`${SUPABASE_URL}/functions/v1/generate-prompt-starters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ 
          documentTitle,
          documentContent: documentContent.substring(0, 10000), // Limit content for efficiency
          userIdea: promptStudioInput,
        }),
      });
      
      const prompts = result.prompts || [];
      
      if (prompts.length > 0) {
        setGeneratedPrompts(prompts);
        toast({
          title: "Prompts Generated",
          description: "Check the suggestions under the chat box.",
        });
      }
    } catch (error: any) {
      console.error("[handleEnhancePrompt] Error:", error);
      const errorDetail = error.response?.error || error.message || "Unknown error";
      toast({ 
        title: "Generation failed", 
        description: `AU encountered an error: ${errorDetail}. Please try again.`, 
        variant: "destructive" 
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent, messageContent?: string, overrideMode?: 'short' | 'mid' | 'detailed') => {
    e.preventDefault();
    const currentInput = (messageContent || input).trim();
    if (!currentInput || isResponding) return;

    if (!user || !selectedDocId) return;

    // Validate query before sending
    const validation = validateQuery(currentInput);
    if (!validation.valid) {
      toast({
        variant: 'destructive',
        title: 'Query Error',
        description: validation.error,
      });
      return;
    }

    setInput('');

    try {
      await sendMessage(currentInput, {
        guide: guideText !== defaultGuideText ? guideText : undefined,
        summaryMode: overrideMode || summaryMode
      });
      setGeneratedPrompts([]);
    } catch (error: any) {
      console.error("[ChatPage] Message error:", error);
      
      let errorMsg = "I'm sorry, I encountered an unexpected hitch while processing your request. My analytical circuits might be a bit overloaded—could you try asking that again in a moment?";
      
      if (error.status === 401) {
        errorMsg = "It looks like your session has timed out for security. Please try refreshing the page or logging back in so we can continue our analysis.";
      } else if (error.message?.includes("API key")) {
        errorMsg = "I'm having trouble connecting to my language center (API Key missing). Please check the backend configuration.";
      } else if (error.message?.includes("Failed to fetch")) {
        errorMsg = "I can't reach the server right now. Please check your internet connection or try again in a few seconds.";
      }
      
      toast({
        variant: 'destructive',
        title: 'AU Chat Issue',
        description: errorMsg,
      });
    }
  };

  const isLoading = docsLoading || isResponding || isSwitchingDocs;

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex h-auto flex-col justify-center gap-2 border-b bg-background px-4 py-3 md:h-14 md:flex-row md:items-center md:px-8 shrink-0">
        <h1 className="font-headline text-lg font-semibold md:text-xl">AU Chat Workspace</h1>
        <div className="flex w-full flex-col gap-2 md:ml-auto md:w-auto md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <Select onValueChange={id => handleDocSelection(id)} value={selectedDocId || ''} disabled={docsLoading}>
              <SelectTrigger className="min-w-0 md:min-w-[250px]">
                <SelectValue placeholder={docsLoading ? 'Loading docs...' : 'Select a document'} />
              </SelectTrigger>
              <SelectContent>
                {documentList.map(doc => (
                  <SelectItem key={doc.id} value={doc.id} disabled={false}>
                    <div className="flex items-center gap-2">
                      <TruncatedText
                        text={doc.fileName}
                        maxWidthClass="max-w-[180px]"
                      />
                      {doc.status !== 'completed' && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 animate-pulse border-yellow-500 text-yellow-600 bg-yellow-50">
                          {doc.status === 'processing' ? 'Processing...' : doc.status}
                        </Badge>
                      )}
                      {doc.type !== 'main_textbook' && (
                         <Badge variant="secondary" className="text-[10px] h-4 px-1">
                           {doc.type?.replace('_', ' ')}
                         </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsClearChatOpen(true)} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear Chat History
                </DropdownMenuItem>
                <div className="h-px bg-muted my-1" />
                <DropdownMenuItem onClick={() => handleSummaryAction('short')}>
                  <Scissors className="mr-2 h-4 w-4" />
                  Short Summary
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSummaryAction('mid')}>
                  <AlignLeft className="mr-2 h-4 w-4" />
                  Mid Summary
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSummaryAction('detailed')}>
                  <FileTextIcon className="mr-2 h-4 w-4" />
                  Detailed Summary
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
              {/* Summary Mode Banner */}
              <AnimatePresence>
                {summaryMode && (
                  <motion.div
                    initial={{ height: 0, opacity: 0, y: -20 }}
                    animate={{ height: 'auto', opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -20 }}
                    className="sticky top-0 z-10 mb-4 overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-medium text-primary shadow-sm backdrop-blur-md">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3 w-3 animate-pulse" aria-hidden="true" />
                        <span>AU is in <strong>{summaryMode.toUpperCase()} SUMMARY</strong> mode. All responses will be formatted accordingly.</span>
                      </div>
                      <button 
                        onClick={() => setSummaryMode(null)}
                        className="rounded-full p-1 hover:bg-primary/20 transition-colors"
                        aria-label="Disable summary mode"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {currentChatHistory.length === 0 && !isResponding && (
                <div className="flex h-full flex-col items-center justify-center pt-16">
                  {isLoading || isFetchingPrompts ? (
                    <div className="flex flex-col items-center justify-center text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="mt-4 text-muted-foreground">{selectedDocName ? `Generating ideas for ${selectedDocName}...` : 'Loading...'}</p>
                    </div>
                  ) : promptStarters.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {promptStarters.map((prompt, i) => (
                        <button key={i} onClick={(e) => handleSendMessage(e as unknown as React.FormEvent, prompt)} className="group flex items-start justify-between rounded-lg bg-muted p-4 text-left text-sm transition-all hover:-translate-y-1 hover:bg-secondary">
                          <p>{prompt}</p>
                          <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      {selectedDocId ? <p>Ask a question about {selectedDocName} to get started.</p> : <p>Select a document above to begin.</p>}
                    </div>
                  )}
                </div>
              )}

              {currentChatHistory.map((message, idx) => (
                <div key={message.id} className="group/message relative">
                  {message.isSystem ? (
                    <div className="flex justify-center my-6 animate-in fade-in zoom-in duration-300">
                        <span className="text-[10px] font-medium px-3 py-1 rounded-full flex items-center gap-1.5 border shadow-sm bg-secondary text-muted-foreground border-border">
                            <Lock className="h-3 w-3" />
                            {message.content}
                        </span>
                    </div>
                  ) : message.role === 'user' ? (
                    <div className="flex items-start gap-4 justify-end">
                      <div className="flex flex-col items-end gap-1 w-full max-w-[85%]">
                        <div className={`relative w-fit rounded-2xl px-4 py-2.5 text-sm bg-primary text-primary-foreground shadow-sm group-hover/message:shadow-md transition-all`}>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                        
                        {/* Message Actions for User - Below bubble, ChatGPT style */}
                         <div className="flex items-center gap-1 mt-1 opacity-50 hover:opacity-100 transition-opacity">
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" 
                             onClick={() => handleCopy(message.id, message.content)} 
                             aria-label="Copy message"
                           >
                             {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                           </Button>
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" 
                             onClick={() => { setInput(message.content); deleteMessage(message.id); textareaRef.current?.focus(); }} 
                             aria-label="Edit message"
                           >
                             <Edit2 className="h-3.5 w-3.5" />
                           </Button>
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-7 w-7 text-muted-foreground hover:text-destructive rounded-md" 
                             onClick={() => deleteMessage(message.id)} 
                             aria-label="Delete message"
                           >
                             <Trash2 className="h-3.5 w-3.5" />
                           </Button>
                         </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-4">
                      <Avatar className="h-9 w-9 flex items-center justify-center bg-primary flex-shrink-0 shadow-sm">
                        <Icons.logo className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
                      </Avatar>
                      <div className="flex-1 pt-1.5 overflow-hidden">
                        {message.isLoading ? (
                          <ThinkingProcess isThinking={true} />
                        ) : (
                          <div className="space-y-4">
                            {/* AU Thought Process */}
                            {message.thought && (
                              <ThinkingProcess thought={message.thought} />
                            )}

                            <TypingAnimation 
                              content={message.content} 
                              shouldAnimate={idx === currentChatHistory.length - 1 && isResponding}
                            />
                            
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

                            {/* Message Actions for AU - Below content, ChatGPT style */}
                            <div className="flex items-center gap-1 mt-2 opacity-50 hover:opacity-100 transition-opacity">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" 
                                onClick={() => handleCopy(message.id, message.content)}
                                aria-label="Copy response"
                              >
                                {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                              
                              {/* Regenerate only for the last assistant message */}
                              {idx === currentChatHistory.length - 1 && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" 
                                      aria-label="Regenerate response"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleRegenerate(message.id)}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      Regenerate (Default)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRegenerate(message.id, 'short')}>
                                      <Scissors className="mr-2 h-4 w-4" />
                                      Regenerate (Short)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRegenerate(message.id, 'mid')}>
                                      <AlignLeft className="mr-2 h-4 w-4" />
                                      Regenerate (Standard)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleRegenerate(message.id, 'detailed')}>
                                      <FileTextIcon className="mr-2 h-4 w-4" />
                                      Regenerate (Detailed)
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}

                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-muted-foreground hover:text-destructive rounded-md" 
                                onClick={() => deleteMessage(message.id)}
                                aria-label="Delete response"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {currentChatHistory.some(m => m.role === 'assistant' && !m.isLoading) && (
                <FeedbackSection sectionName="Chat" />
              )}
            </div>
        </ScrollArea>
        <AnimatePresence>
            {showScrollButton && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-4 right-1/2 translate-x-1/2 z-20"
                >
                    <Button
                        size="icon"
                        variant="outline"
                        className="rounded-full shadow-lg h-8 w-8 bg-background/80 backdrop-blur-sm border-muted-foreground/20 hover:bg-background"
                        onClick={() => scrollToBottom('smooth')}
                    >
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                </motion.div>
            )}
        </AnimatePresence>
      </div>

      <div className="border-t bg-background px-4 pb-4 pt-2">
        <div className="relative mx-auto max-w-4xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {selectedDocName ? `Chatting with: ${selectedDocName}` : 'Select a document to start chatting.'}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsGuideOpen(true)}
                  disabled={!user}
                  className="hover:text-primary transition-all duration-300 hover:scale-110"
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" align="center">
                <p>AU Guide (Intelligent Patterns)</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <form onSubmit={(e) => handleSendMessage(e)} className="flex w-full items-end space-x-2">
            <div className="relative flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isLoading || !selectedDocId || !isOnline}
                    className={`absolute left-1.5 top-1/2 -translate-y-1/2 h-9 w-9 flex-shrink-0 transition-all duration-300 hover:scale-110 ${summaryMode ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary'}`}
                  >
                    {summaryMode === 'short' ? <Scissors className="h-5 w-5" /> :
                     summaryMode === 'mid' ? <AlignLeft className="h-5 w-5" /> :
                     summaryMode === 'detailed' ? <FileTextIcon className="h-5 w-5" /> :
                     <Sparkles className="h-5 w-5" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setSummaryMode(null)}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Default (Auto)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSummaryMode('short')}>
                    <Scissors className="mr-2 h-4 w-4" />
                    Short Answer
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSummaryMode('mid')}>
                    <AlignLeft className="mr-2 h-4 w-4" />
                    Standard Answer
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSummaryMode('detailed')}>
                    <FileTextIcon className="mr-2 h-4 w-4" />
                    Detailed Answer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Textarea
                id="message"
                ref={textareaRef}
                placeholder={!isOnline ? "You are offline. AU chat is disabled." : (selectedDocId ? "Message AU..." : "Please select a document to start chatting.")}
                className="flex-1 resize-none rounded-full border bg-secondary p-3 pl-12 pr-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
                disabled={isLoading || !selectedDocId || !isOnline}
              />
            </div>

            <Button 
              type={isResponding ? "button" : "submit"} 
              size="icon" 
              className={`h-12 w-12 shrink-0 rounded-full transition-all ${isResponding ? 'bg-destructive hover:bg-destructive/90' : ''}`}
              disabled={(!input.trim() || !selectedDocId || !isOnline) && !isResponding}
              onClick={(e) => {
                  if (isResponding) {
                      e.preventDefault();
                      stopGeneration();
                  } else {
                      // Explicitly trigger submit if needed, but type="submit" usually handles it.
                      // However, since we are inside a form, we can let the form handler take over.
                      // If this onClick is preventing default, that might be the issue.
                      // Let's NOT prevent default here unless isResponding.
                  }
              }}
            >
              {isResponding ? (
                  <div className="relative flex items-center justify-center">
                     <Square className="h-4 w-4 fill-current" />
                     <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-20"></span>
                  </div>
              ) : (
                  <Send className="h-5 w-5" />
              )}
            </Button>
          </form>
        </div>
      </div>
      </TooltipProvider>

      {/* Dialogs */}
      <Dialog open={isPromptStudioOpen} onOpenChange={setIsPromptStudioOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>AU Prompt Studio</DialogTitle>
            <DialogDescription>
              Tell AU what kind of questions or study aids you need, and it will generate 4 optimized prompts for you.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="idea">Your Goal</Label>
              <Input
                id="idea"
                placeholder="e.g. 'Test me on key dates' or 'Explain difficult concepts simply'"
                value={promptStudioInput}
                onChange={(e) => setPromptStudioInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPromptStudioOpen(false)}>Cancel</Button>
            <Button onClick={handleEnhancePrompt} disabled={!promptStudioInput.trim() || isGenerating}>
              {isGenerating ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  Generate Prompts
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isGuideOpen} onOpenChange={setIsGuideOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>AU Guide</DialogTitle>
            <DialogDescription>
              Customize how AU answers your questions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="guide">Your Preferences</Label>
              <Textarea
                id="guide"
                className="h-[150px] resize-none"
                placeholder="e.g. Always explain with examples. Keep answers under 3 sentences."
                value={guideText}
                onChange={(e) => setGuideText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                AU will use these instructions for every response until you change them.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setGuideText(defaultGuideText); setIsGuideOpen(false); }}>Reset to Default</Button>
            <Button onClick={() => setIsGuideOpen(false)}>Save & Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isClearChatOpen} onOpenChange={setIsClearChatOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Chat History?</AlertDialogTitle>
            <AlertDialogDescription>
              ⚠️ Clearing chat history will remove AU&apos;s memory for this document. AU will no longer remember your learning progress here.
              <br/><br/>
              This will clear your local conversation history. It will NOT delete the document itself or any exam predictions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={clearChat} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Yes, Clear History
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
