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
  Check
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
import { Icons } from '@/components/icons';
import { useRouter } from 'next/navigation';
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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  citations?: string[];
  isSummary?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  originalContent?: string;
}

interface StoredChatHistory {
  timestamp: number;
  messages: ChatMessage[];
}

const getLocalStorageKey = (userId: string, docId: string) => `chat_prompt_starters_${userId}_${docId}`;
const getFirstTimeKey = (userId: string, docId: string) => `chat_first_time_${userId}_${docId}`;
const getChatHistoryKey = (userId: string, docId: string) => `chat_history_${userId}_${docId}`;
const getSummaryModeKey = (userId: string, docId: string) => `chat_summary_mode_${userId}_${docId}`;
const getInputKey = (userId: string, docId: string) => `chat_input_${userId}_${docId}`;
const getGuideKey = (userId: string) => `au_chat_guide_${userId}`;

const defaultGuideText =
  "Use this AU Guide to tell the assistant how you like to study. For example, ask for short step-by-step explanations, exam-focused answers, or extra context. You can edit this text any time and AU will follow it when answering your questions.";

import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { useAuChat } from '@/hooks/api/use-au-chat';
import { getDocumentText } from '@/lib/api/documents';

export default function ChatPage() {
  const { toast } = useToast();
  const router = useRouter();
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
    fetchPrompts
  } = useAuChat(selectedDocId);

  const documentList = useMemo(() => apiDocuments
    .filter(d => d.document_type === 'main_textbook' || d.document_type === 'exam_questions') // Keep exams visible if desired, or strict 'main_textbook'
    .map(d => ({ 
      id: d.id, 
      fileName: d.file_name, 
      status: d.status,
      type: d.document_type 
    }))
    .filter(d => d.type === 'main_textbook'), // Strict filter: ONLY main textbooks appear in chat selector
    [apiDocuments]
  );

  const [input, setInput] = useState('');
  const [isSwitchingDocs, setIsSwitchingDocs] = useState(false);
  const [isPromptStudioOpen, setIsPromptStudioOpen] = useState(false);
  const [promptStudioInput, setPromptStudioInput] = useState('');
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptStarters, setPromptStarters] = useState<string[]>([]);
  const [isFetchingPrompts, setIsFetchingPrompts] = useState(false);
  const [showFirstTimeDialog, setShowFirstTimeDialog] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideText, setGuideText] = useState(defaultGuideText);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fetchingPromptsRef = useRef(false);

  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
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
    setCurrentChatHistory(newHistory);
    
    if (mode) {
      setSummaryMode(mode);
      // Small delay to ensure state update if we were relying on it, 
      // but we will pass it explicitly to handleSendMessage
    }

    handleSendMessage({ preventDefault: () => {} } as React.FormEvent, userMessage.content, mode);
  };

  const toggleThought = (messageId: string) => {
    setExpandedThoughts(prev => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  const handleToggleSummary = (mode: 'short' | 'mid' | 'detailed') => {
    setSummaryMode(prev => prev === mode ? null : mode);
  };

  const clearChat = () => {
    setCurrentChatHistory([]);
    if (user && selectedDocId) {
      localStorage.removeItem(getChatHistoryKey(user.id, selectedDocId));
    }
    toast({ title: "Chat cleared", description: "The conversation history has been reset." });
  };

  const deleteMessage = (messageId: string) => {
    setCurrentChatHistory(prev => prev.filter(m => m.id !== messageId));
  };

  const editMessage = (messageId: string, newContent: string) => {
    setCurrentChatHistory(prev => prev.map(m => m.id === messageId ? { ...m, content: newContent } : m));
  };

  const handleSummaryAction = async (type: 'short' | 'mid' | 'detailed') => {
    if (!selectedDocId || isResponding) return;
    const newMode = summaryMode === type ? null : type;
    setSummaryMode(newMode);
    
    if (newMode) {
      toast({ 
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} Summary Mode Active`, 
        description: `AU will now provide ${type} responses. Click again to disable.` 
      });
    }
  };

  useEffect(() => {
    if (!user) {
      setGuideText(defaultGuideText);
      return;
    }
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem(getGuideKey(user.id)) : null;
      if (stored && stored.trim()) {
        setGuideText(stored);
      } else {
        setGuideText(defaultGuideText);
      }
    } catch {
      setGuideText(defaultGuideText);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    try {
      if (guideText && guideText !== defaultGuideText) {
        localStorage.setItem(getGuideKey(user.id), guideText);
      } else {
        localStorage.removeItem(getGuideKey(user.id));
      }
    } catch {
    }
  }, [guideText, user]);

  const selectedDoc = useMemo(() => documentList.find(doc => doc.id === selectedDocId), [documentList, selectedDocId]);
  const selectedDocName = useMemo(() => selectedDoc?.fileName, [selectedDoc]);

  const getDocumentContent = useCallback(async (docId: string): Promise<string> => {
    if (!user) return '';
    return getDocumentText(user, docId);
  }, [user]);

  const lastLoadedUserId = useRef<string | null>(null);
  const lastLoadedDocId = useRef<string | null>(null);

  useEffect(() => {
    if (user && selectedDocId) {
      // Only reload if the user ID or document ID has actually changed
      if (lastLoadedUserId.current === user.id && lastLoadedDocId.current === selectedDocId) {
        return;
      }

      // Load Chat History
      const storedHistoryJSON = localStorage.getItem(getChatHistoryKey(user.id, selectedDocId));
      if (storedHistoryJSON) {
        try {
          const storedHistory: StoredChatHistory = JSON.parse(storedHistoryJSON);
          const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
          if (storedHistory.timestamp < twoDaysAgo) {
            localStorage.removeItem(getChatHistoryKey(user.id, selectedDocId));
            setCurrentChatHistory([]);
            toast({ title: "Chat history expired", description: "Your chat history older than 2 days has been cleared." });
          } else {
            setCurrentChatHistory(storedHistory.messages);
          }
        } catch {
          setCurrentChatHistory([]);
        }
      } else {
        setCurrentChatHistory([]);
      }

      // Load Summary Mode
      const storedSummaryMode = localStorage.getItem(getSummaryModeKey(user.id, selectedDocId));
      if (storedSummaryMode === 'short' || storedSummaryMode === 'mid' || storedSummaryMode === 'detailed') {
        setSummaryMode(storedSummaryMode);
      } else {
        setSummaryMode(null);
      }

      // Load Input
      const storedInput = localStorage.getItem(getInputKey(user.id, selectedDocId));
      if (storedInput) {
        setInput(storedInput);
      } else {
        setInput('');
      }
      
      lastLoadedUserId.current = user.id;
      lastLoadedDocId.current = selectedDocId;
    }
  }, [user, selectedDocId, toast]);

  useEffect(() => {
    if (user && selectedDocId) {
      // Save Chat History
      if (currentChatHistory.length > 0) {
        try {
          const historyToStore: StoredChatHistory = {
            timestamp: Date.now(),
            messages: currentChatHistory.filter(m => !m.isLoading),
          };
          localStorage.setItem(getChatHistoryKey(user.id, selectedDocId), JSON.stringify(historyToStore));
        } catch (e) {
          console.error("Failed to save chat history to localStorage", e);
        }
      }

      // Save Summary Mode
      if (summaryMode) {
        localStorage.setItem(getSummaryModeKey(user.id, selectedDocId), summaryMode);
      } else {
        localStorage.removeItem(getSummaryModeKey(user.id, selectedDocId));
      }

      // Save Input
      if (input.trim()) {
        localStorage.setItem(getInputKey(user.id, selectedDocId), input);
      } else {
        localStorage.removeItem(getInputKey(user.id, selectedDocId));
      }
    }
  }, [currentChatHistory, summaryMode, input, user, selectedDocId]);

  const handleDocSelection = (newSelectedId: string | null) => {
    if (newSelectedId !== selectedDocId) {
      setIsSwitchingDocs(true);
      setSelectedDocId(newSelectedId);
      setCurrentChatHistory([]);
      setPromptStarters([]);
      setTimeout(() => setIsSwitchingDocs(false), 100); // Give time for other effects to catch up
    }
  };

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

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        }
    }
  };

  // Auto-scroll logic:
  // 1. When a new message is added (length changes), scroll to bottom.
  // 2. When content updates (streaming), only scroll if user was already at bottom.
  const lastHistoryLength = useRef(currentChatHistory.length);
  
  useEffect(() => {
    const isNewMessage = currentChatHistory.length > lastHistoryLength.current;
    lastHistoryLength.current = currentChatHistory.length;

    // If it's a new message, force scroll (usually user sent it or bot started replying)
    if (isNewMessage) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
        return;
    }

    // If it's just an update (streaming) and we are NOT scrolled up, keep scrolling
    if (!showScrollButton) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [currentChatHistory, showScrollButton]);

  const handleScroll = useCallback(() => {
      if (scrollAreaRef.current) {
          const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
              const { scrollTop, scrollHeight, clientHeight } = viewport;
              const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
              setShowScrollButton(distanceFromBottom > 100); // Show button if >100px from bottom
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
    if (!selectedDocId || !selectedDocName || !user || !isOnline || fetchingPromptsRef.current) return;
    fetchingPromptsRef.current = true;
    setIsFetchingPrompts(true);
    setPromptStarters([]);
    try {
      const documentContent = await getDocumentContent(selectedDocId);
      if (!documentContent) return;
      
      // Smart suggestion: Scan chat history and document patterns
      const historyContext = currentChatHistory.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
      
      const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
      
      const result = await safeFetch(`${SUPABASE_URL}/functions/v1/au-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ 
          messages: [{ 
            role: 'user', 
            content: `Based on the document "${selectedDocName}" and the recent chat history:\n${historyContext}\n\nGenerate 4 smart and relevant next questions the user might want to ask. The questions should be accurate and tied to the document content. Return ONLY a JSON array of strings.` 
          }],
          useRAG: true,
          selectedDocId
        }),
      });

      let prompts: string[] = [];
      try {
        const parsed = JSON.parse(result.answer);
        prompts = Array.isArray(parsed) ? parsed : [];
      } catch {
        // Fallback to legacy function if smart generation fails or returns plain text
        const legacyResult = await safeFetch(`${SUPABASE_URL}/functions/v1/generate-prompt-starters`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ documentTitle: selectedDocName, documentContent }),
        });
        prompts = legacyResult.prompts ?? [];
      }
      
      setPromptStarters(prompts);
      localStorage.setItem(getLocalStorageKey(user.id, selectedDocId), JSON.stringify(prompts));
    } catch (error) {
      console.error(error);
      setPromptStarters([]);
    } finally {
      setIsFetchingPrompts(false);
      fetchingPromptsRef.current = false;
    }
  }, [selectedDocId, selectedDocName, user, session, getDocumentContent, isOnline, currentChatHistory]);

  useEffect(() => {
    if (!selectedDocId || !user) {
      setPromptStarters([]);
      return;
    }
    const firstTimeKey = getFirstTimeKey(user.id, selectedDocId);
    const isFirstTime = localStorage.getItem(firstTimeKey) === null;
    setPromptStarters([]);
    if (isFirstTime) {
        setShowFirstTimeDialog(true);
    }
    else {
      const storedPrompts = localStorage.getItem(getLocalStorageKey(user.id, selectedDocId));
      if (storedPrompts) {
        setPromptStarters(JSON.parse(storedPrompts));
      } else if (isOnline) {
        fetchPromptStarters();
      }
    }
  }, [selectedDocId, user, isOnline, fetchPromptStarters]);

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
    setPromptStarters([]);

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
    <main className="flex h-full flex-col">
      <header className="flex h-auto flex-col justify-center gap-2 border-b bg-background px-4 py-3 md:h-14 md:flex-row md:items-center md:px-8">
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
                <DropdownMenuItem onClick={clearChat} className="text-destructive">
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
                  {message.role === 'user' ? (
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
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Icons.logo className="h-5 w-5 animate-spin" aria-hidden="true" />
                            <span>AU is thinking...</span>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {/* AU Thought Process */}
                            {message.thought && (
                              <div className="mb-2">
                                <button 
                                  onClick={() => toggleThought(message.id)}
                                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
                                  aria-expanded={expandedThoughts[message.id]}
                                >
                                  {expandedThoughts[message.id] ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                                  <span>AU Thought Process</span>
                                </button>
                                {expandedThoughts[message.id] && (
                                  <div className="mt-2 rounded-md bg-muted/50 p-3 text-xs italic text-muted-foreground border-l-2 border-primary/30">
                                    <p className="whitespace-pre-wrap">{message.thought}</p>
                                  </div>
                                )}
                              </div>
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
                className="flex-1 resize-none rounded-full border bg-secondary p-3 pl-14 pr-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
                disabled={isLoading || !selectedDocId || !isOnline}
              />
            </div>

            <Button type="submit" size="icon" className="h-12 w-12 shrink-0 rounded-full" disabled={isLoading || !input.trim() || !selectedDocId || !isOnline}>
              {isResponding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </form>

              {/* Enhanced Prompt Suggestions directly under chat */}
              {generatedPrompts.length > 0 && (
                <div className="mt-4 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">AU Suggestions</Label>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 px-2 text-[10px]" 
                      onClick={() => setGeneratedPrompts([])}
                    >
                      Clear
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {generatedPrompts.map((prompt, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        className="h-auto py-1.5 px-3 text-left whitespace-normal hover:bg-primary/5 hover:border-primary/50 text-[11px] transition-all hover:-translate-y-0.5 rounded-full"
                        onClick={() => {
                          setInput(prompt);
                          setGeneratedPrompts([]); // Clear after selection to keep it clean
                          textareaRef.current?.focus();
                        }}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Info className="h-3 w-3" />
                <span>
                  {user?.is_anonymous 
                    ? "Guest mode self-destruct in 24 hours." 
                    : "Chat history is stored locally on your device."}
                </span>
              </div>
        </div>
      </div>
      </TooltipProvider>

      <Dialog open={isPromptStudioOpen} onOpenChange={setIsPromptStudioOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Enhance Your Prompt</DialogTitle>
            <DialogDescription>
              Enter a basic idea or topic, and AU will scan the document to generate highly intelligent study prompts for you.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="prompt-input">Your Idea</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="prompt-input"
                  placeholder="e.g., Photosynthesis..."
                  value={promptStudioInput}
                  onChange={(e) => setPromptStudioInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEnhancePrompt()}
                  autoFocus
                  className="flex-1"
                />
                <div className="flex gap-2">
                  <Button onClick={handleEnhancePrompt} disabled={isGenerating || !promptStudioInput.trim()} className="flex-1 sm:flex-none">
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                    Enhance
                  </Button>
                  <Button 
                    variant="secondary" 
                    onClick={() => { 
                      const ideas = ["What are the key concepts?", "Summarize the main arguments", "Explain the core definitions", "Create a study plan"];
                      const randomIdea = ideas[Math.floor(Math.random() * ideas.length)];
                      setPromptStudioInput(randomIdea); 
                      // Small delay to allow state update before calling
                      setTimeout(handleEnhancePrompt, 100); 
                    }} 
                    disabled={isGenerating}
                    className="flex-1 sm:flex-none"
                  >
                    Auto Generate
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground italic">Tip: Type a keyword or click 'Auto Generate' for AU to suggest study paths.</p>
            </div>

            {generatedPrompts.length > 0 && (
              <div className="space-y-3 pt-2">
                <Label>AU Suggestions</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {generatedPrompts.map((prompt, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      className="justify-start h-auto py-3 px-4 text-left whitespace-normal hover:bg-primary/5 hover:border-primary/50 text-xs transition-all hover:-translate-y-1"
                      onClick={() => {
                        setInput(prompt);
                        setIsPromptStudioOpen(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isGuideOpen} onOpenChange={setIsGuideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AU Guide</DialogTitle>
            <DialogDescription>
              Describe how you want AU to answer your questions. This guide is stored on your device and can be updated any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="au-guide">Guide</Label>
            <Textarea
              id="au-guide"
              value={guideText}
              onChange={(e) => setGuideText(e.target.value)}
              rows={6}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
