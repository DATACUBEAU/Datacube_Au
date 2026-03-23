'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { formatDistanceStrict } from 'date-fns';
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
  Brain,
  Quote,
  Copy,
  RotateCcw,
  Check,
  Globe,
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
import { ToastAction } from '@/components/ui/toast';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Icons } from '@/components/icons';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { logOnce } from '@/lib/log/dedupe';
import type { RagBasedQuestionAnsweringOutput } from '@/app/actions';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import type { AuDocumentRow } from '@/lib/au/types';
import { getAuDocumentChunksText, listAuDocumentsForUser } from '@/lib/au/documents';
import { safeFetch } from '@/lib/api/safe-fetch';
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';
import { validateQuery } from '@/lib/upload/file-types';
import { cn } from '@/lib/utils';
import { FileNameText } from '@/components/FileNameText';
import { DocumentSelectValue } from '@/components/document-select-value';
import { ThinkingProcess } from '@/components/thinking-process';
import { useStore } from '@/hooks/use-store';
import { AUThrottlingDialog } from '@/components/au-throttling-dialog';
import { OfflineGuard } from '@/components/offline-guard';
import { useChatRuntime } from '@/components/providers/chat-runtime-provider';
import { GlobalHistoryPrompt } from '@/components/global-history-prompt';
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { ChatPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { useLimitationsAgent } from '@/hooks/use-limitations-agent';
import { LimitAlertCard } from '@/components/limits/limit-alert-card';
import { LimitToast } from '@/components/limits/limit-toast';
import { toApiRequestError, type ApiRequestError } from '@/lib/api/api-contract';

import { type ChatMessage } from '@/lib/api/chat';
import { AssistantResponseBody } from '@/components/chat/assistant-response-body';
import { FollowUpSuggestions } from '@/components/chat/follow-up-suggestions';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { useAuChat } from '@/hooks/api/use-au-chat';
import { getDocumentText } from '@/lib/api/documents';
import {
  buildFollowUpSuggestions,
  formatAssistantResponseText,
  formatAssistantThought,
  normalizeAssistantCitations,
} from '@/lib/chat/assistant-response';

interface StoredChatHistory {
  timestamp: number;
  messages: ChatMessage[];
}

const getSummaryModeKey = (userId: string, docId: string) => `chat_summary_mode_${userId}_${docId}`;
const getInputKey = (userId: string, docId: string) => `chat_input_${userId}_${docId}`;
const getGuideKey = (userId: string) => `au_chat_guide_${userId}`;
const defaultGuideText =
  "Use this AU Guide to tell the assistant how you like to study. For example, ask for short step-by-step explanations, exam-focused answers, or extra context. You can edit this text any time and AU will follow it when answering your questions.";
const QUICK_ACTION_PROMPTS = [
  'Summarize this document.',
  'What is this document about?',
  'Extract the key topics from this document.',
  'Generate study questions from this document.',
  'Analyze past question relevance for this textbook and linked past questions.',
] as const;

function findPreviousUserPrompt(history: ChatMessage[], assistantIndex: number): string {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (history[index]?.role === 'user') {
      return String(history[index]?.content || '');
    }
  }
  return '';
}

function chatErrorTitle(error: ApiRequestError | null): string {
  if (!error) return 'Chat issue';
  if (error.status === 401 || error.code === 'UNAUTHORIZED' || error.code === 'AUTHENTICATION_FAILED') {
    return 'Authentication failed';
  }
  if (error.status === 403 || error.code === 'FORBIDDEN' || error.code === 'TIER_ACCESS_DENIED') {
    return 'Access denied';
  }
  if (
    error.status === 429 ||
    error.code === 'LIMIT_REACHED' ||
    error.code === 'LIMIT_EXCEEDED' ||
    error.code === 'PRO_REQUIRED'
  ) {
    return 'Usage limit reached';
  }
  if (
    error.code === 'MODEL_SERVICE_UNAVAILABLE' ||
    error.code === 'UPSTREAM_TIMEOUT' ||
    error.code === 'ROUTING_FAILED' ||
    error.status === 503 ||
    error.status === 504
  ) {
    return 'Model service unavailable';
  }
  if (error.status === 400 || error.code === 'INVALID_REQUEST_PAYLOAD') {
    return 'Invalid request payload';
  }
  return 'Unexpected server error';
}

function chatErrorDescription(error: ApiRequestError): string {
  if (error.code === 'OFFLINE' || error.message.includes('Failed to fetch')) {
    return "I can't reach the server right now. Please check your internet connection and try again.";
  }

  if (error.status === 401) {
    return 'Authentication failed. Please refresh the page and sign in again.';
  }

  if (error.status === 403) {
    return "You don't have permission to complete that chat request.";
  }

  return error.message;
}

export default function ChatPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const isOnline = useOnlineStatus();
  const canChat = isOnline && !!session?.access_token && !isLoadingAuth;

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const {
    documents: apiDocuments,
    loading: docsLoading,
    refresh: refreshDocuments,
    isUsingCachedData,
    cachedAt,
  } = useAuDocuments();
  const { connectionStatus } = useChatRuntime();

  // Sync AU State with Global Background Animation
  const setAuAnimationState = useStore(state => state.setAuAnimationState);
  const auAnimationState = useStore(state => state.auAnimationState);
  const upgradeBlocked = useStore(state => state.upgradeBlocked);
  
  // Reset animation state when leaving chat page
  useEffect(() => {
      return () => setAuAnimationState('idle');
  }, [setAuAnimationState]);

  const documentList = useMemo(
    () =>
      apiDocuments
        .filter((d) => d.document_type === 'main_textbook')
        .map((d) => ({
          id: d.id,
          fileName: d.file_name,
          status: d.status,
          type: d.document_type,
          createdAt: d.created_at,
          expiresAt: d.expires_at ?? undefined,
        })),
    [apiDocuments]
  );

  const [input, setInput] = useState('');
  const [isSwitchingDocs, setIsSwitchingDocs] = useState(false);
  const [isPromptStudioOpen, setIsPromptStudioOpen] = useState(false);
  const [promptStudioInput, setPromptStudioInput] = useState('');
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideText, setGuideText] = useState(defaultGuideText);
  const [browsingMode, setBrowsingMode] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastRetryPayloadRef = useRef<{
    message: string;
    options: {
      guide?: string;
      summaryMode?: 'short' | 'mid' | 'detailed' | null;
      browsingMode?: boolean;
    };
  } | null>(null);

  const [summaryMode, setSummaryMode] = useState<'short' | 'mid' | 'detailed' | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; content: string; role: 'user' | 'assistant' } | null>(null);
  const [showThrottlingDialog, setShowThrottlingDialog] = useState(false);
  const [showWhatsappDialog, setShowWhatsappDialog] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [chatMode, setChatMode] = useState<'au' | 'global'>('au');

  // Sync Chat Mode with Selected Doc
  useEffect(() => {
      if (selectedDocId === 'global') {
          setChatMode('global');
      } else {
          setChatMode('au');
      }
  }, [selectedDocId]);

  const handleModeChange = (mode: string) => {
      if (mode === 'global') {
          handleDocSelection('global');
      } else {
          // Switch back to AU: Select first available document
          const firstDoc = documentList.find((doc) => doc.status === 'completed') || documentList[0];
          if (firstDoc) {
              handleDocSelection(firstDoc.id);
          } else {
              handleDocSelection(null);
          }
      }
  };


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


  const deleteMessage = (messageId: string) => {
    deleteMessagePersisted(messageId);
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

  const handleWhatsAppRedirect = () => {
    const phoneNumber = '2349036553377';
    const message = "Hello Datacube AU Support! I just entered Datacube AU and have a question.";
    const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
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
  const completedDocumentList = useMemo(
    () => documentList.filter((doc) => doc.status === 'completed'),
    [documentList],
  );
  const selectedDocName = useMemo(() => selectedDoc?.fileName, [selectedDoc]);
  const selectedDocExpiryLabel = useMemo(() => {
    if (!selectedDoc?.expiresAt) return null;
    return new Date(selectedDoc.expiresAt).getTime() <= now
      ? 'Expired'
      : `Expires in ${formatDistanceStrict(new Date(now), new Date(selectedDoc.expiresAt))}`;
  }, [now, selectedDoc?.expiresAt]);
  const lastUploadedDocument = useMemo(
    () =>
      completedDocumentList
        .slice()
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] ?? null,
    [completedDocumentList],
  );
  const { 
    history: currentChatHistory, 
    setHistory: setCurrentChatHistory,
    setHistoryPersisted,
    deleteMessagePersisted,
    isResponding,
    sendMessage,
    stopGeneration,
    fetchPrompts,
    isInitialized,
    clearChat,
    lastError: chatRequestError,
    clearLastError,
  } = useAuChat(selectedDocId, {
    activeDocumentName: selectedDocName ?? null,
    lastUploadedDocumentId: lastUploadedDocument?.id ?? null,
    documentCountInScope: completedDocumentList.length,
  });

  useEffect(() => {
    let newState: 'idle' | 'thinking' | 'responding' = 'idle';

    if (isResponding) {
      const lastMsg = currentChatHistory[currentChatHistory.length - 1];
      if (lastMsg?.isLoading && !lastMsg.content) {
        newState = 'thinking';
      } else {
        newState = 'responding';
      }
    }

    if (auAnimationState !== newState) {
      setAuAnimationState(newState);
    }
  }, [isResponding, currentChatHistory, setAuAnimationState, auAnimationState]);
  const {
    primaryAlert: chatLimitAlert,
    toastCandidate: chatLimitToast,
    markToastShown: markChatLimitToastShown,
    dismissAlert: dismissChatLimitAlert,
    clearLimitError: clearChatLimitError,
    reportLimitError: reportChatLimitError,
  } = useLimitationsAgent({
    route: 'chat',
  });

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
  }, [user, selectedDocId]);

  useEffect(() => {
    if (user && selectedDocId) {
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
  }, [summaryMode, input, user, selectedDocId]);

  useEffect(() => {
    // Only run this ONCE on mount (page reload check)
    // We check if there are loading messages that are stale
    // However, since state is hydrated from localStorage, this effect runs every time history changes if not careful
    // We should rely on the initial load effect (line 331) to handle this cleanup instead of a separate effect
    // Or, only run if the component just mounted.
  }, []); // Empty dependency array = mount only

  // Move the cleanup logic into the history loading effect or a specialized effect
  useEffect(() => {
      // If we loaded history and it has stuck loading states, clear them
      // This is a safety net for any "stuck" state that persists in memory during session
      const stuckMessages = currentChatHistory.filter(m => m.isLoading && !isResponding);
      if (stuckMessages.length > 0) {
           setCurrentChatHistory(prev => prev.map(m => (m.isLoading && !isResponding) ? { ...m, isLoading: false, content: m.content || "⚠️ Generation interrupted." } : m));
      }
  }, [currentChatHistory, isResponding, setCurrentChatHistory]);

  const updateUrlParams = useCallback((docId: string | null) => {
    if (!docId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('docId', docId);
    window.history.pushState({}, '', url);
  }, []);

  const handleDocSelection = useCallback((newSelectedId: string | null) => {
    if (newSelectedId !== selectedDocId) {
      setIsSwitchingDocs(true);
      setSelectedDocId(newSelectedId);
      updateUrlParams(newSelectedId);
      setCurrentChatHistory([]);
      setTimeout(() => setIsSwitchingDocs(false), 100);
    }
  }, [selectedDocId, updateUrlParams, setCurrentChatHistory]);

  // Handle URL params for deep linking
  useEffect(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const docIdParam = searchParams.get('docId');
      if (docIdParam && docIdParam !== selectedDocId && documentList.some(d => d.id === docIdParam)) {
          handleDocSelection(docIdParam);
      }
  }, [documentList, selectedDocId, handleDocSelection]);

  useEffect(() => {
    if (docsLoading || !user) return;

    if (documentList.length > 0) {
        const completedDocIds = documentList.filter((doc) => doc.status === 'completed').map((doc) => doc.id);
        const docIds = completedDocIds.length > 0 ? completedDocIds : documentList.map((doc) => doc.id);
        if (!selectedDocId || !docIds.includes(selectedDocId)) {
            handleDocSelection(docIds[0]);
        }
    } else {
        handleDocSelection(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentList, docsLoading, user]);

  // Scroll position key
  const getScrollPosKey = (userId: string, docId: string) => `chat_scroll_pos_${userId}_${docId}`;

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
           localStorage.setItem(getScrollPosKey(user.id, selectedDocId), viewport.scrollTop.toString());
       }
    }
  }, [user, selectedDocId]);

  const restoreScrollPosition = useCallback(() => {
      if (scrollAreaRef.current && user && selectedDocId) {
          const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
          const savedPos = localStorage.getItem(getScrollPosKey(user.id, selectedDocId));
          if (viewport && savedPos) {
              viewport.scrollTop = parseInt(savedPos, 10);
          } else if (viewport) {
              // Default to bottom if no saved pos
              viewport.scrollTop = viewport.scrollHeight;
          }
      }
  }, [user, selectedDocId]);

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
              
              // Save scroll position periodically or on end (using debounce ideally, but direct set is ok for now)
              // To avoid spamming localStorage, we could debounce this.
              // For now, let's just save it.
              lastScrollPos.current = scrollTop;
          }
      }
  }, []);

  // Save scroll on unmount or doc switch
  useEffect(() => {
      return () => {
          if (user && selectedDocId && lastScrollPos.current > 0) {
              localStorage.setItem(getScrollPosKey(user.id, selectedDocId), lastScrollPos.current.toString());
          }
      };
  }, [user, selectedDocId]);

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

  const handleEnhancePrompt = async () => {
    if (!promptStudioInput.trim() || !selectedDocId || isGenerating || !user) return;
    if (!canChat) {
      logOnce('warn', 'chat:enhance_prompt:blocked', '[chat] Prompt studio blocked (auth/online)');
      return;
    }
    if (!session?.access_token) {
      logOnce('warn', 'chat:enhance_prompt:no_token', '[chat] Prompt studio blocked (no access token)');
      return;
    }
    
    setIsGenerating(true);
    setGeneratedPrompts([]);
    
    // Close dialog if open, since we'll show them under the chat
    setIsPromptStudioOpen(false);

    try {
      const documentContent = await getDocumentContent(selectedDocId);
      const documentTitle = selectedDocName || 'Current Document';
      const doRequest = async (token: string | null) =>
        safeFetch(`/api/proxy/generate-prompt-starters`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({ 
            documentTitle,
            documentContent: documentContent.substring(0, 10000), // Limit content for efficiency
            userIdea: promptStudioInput,
          }),
        });

      let accessToken = await getSupabaseAccessToken();
      let result = await doRequest(accessToken);

      if (result.status === 401) {
        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (!error) {
            accessToken = data.session?.access_token ?? null;
          }
        } catch {
          // Keep original unauthorized response.
        }

        if (accessToken) {
          result = await doRequest(accessToken);
        }
      }

      if (!result.ok) {
        const raw = await result.text().catch(() => '');
        throw new Error(`Prompt enhancement request failed: ${result.status} ${raw}`.trim());
      }
      
      const data = await result.json();
      const prompts = data.prompts || [];
      
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

  const handleReply = (messageId: string, content: string, role: 'user' | 'assistant') => {
    setReplyingTo({ id: messageId, content, role });
    textareaRef.current?.focus();
  };

  const handleSendMessage = async (e: React.FormEvent, messageContent?: string, overrideMode?: 'short' | 'mid' | 'detailed') => {
    e.preventDefault();
    const currentInput = (messageContent || input).trim();
    if (!currentInput || isResponding) return;

    if (!user || !selectedDocId) return;
    if (!canChat) {
      logOnce('warn', 'chat:send:blocked', '[chat] Send blocked (auth/online)');
      return;
    }
    if (!selectedDoc || selectedDoc.status !== 'completed') {
      toast({
        variant: 'destructive',
        title: 'Document not ready',
        description: 'Wait for this document to complete processing before chatting.',
      });
      return;
    }

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

    const shouldClearComposer = messageContent === undefined;
    if (shouldClearComposer) {
      setInput('');
    }

    // Construct message with reply context if present
    let finalMessage = currentInput;
    if (replyingTo) {
      const replyPrefix = `> ${replyingTo.role === 'user' ? 'User' : 'AU'}: ${replyingTo.content.split('\n')[0].substring(0, 100)}...\n\n`;
      finalMessage = replyPrefix + currentInput;
      setReplyingTo(null);
    }

    const requestOptions = {
      guide: guideText !== defaultGuideText ? guideText : undefined,
      summaryMode: overrideMode || summaryMode,
      browsingMode,
    };
    lastRetryPayloadRef.current = {
      message: finalMessage,
      options: requestOptions,
    };

    try {
      await sendMessage(finalMessage, requestOptions);
      clearChatLimitError();
      clearLastError();
      setGeneratedPrompts([]);
    } catch (error: any) {
      const normalizedError = toApiRequestError(error, 'Unexpected chat error');
      const errorDescription = chatErrorDescription(normalizedError);
      console.error(
        `[ChatPage] Message error: ${JSON.stringify({
          code: normalizedError.code,
          status: normalizedError.status,
          message: errorDescription,
          retryable: normalizedError.retryable,
          requestId: normalizedError.requestId,
          correlationId: normalizedError.correlationId,
          details: normalizedError.details,
        })}`,
      );
      reportChatLimitError(normalizedError);
      
      if (normalizedError.isThrottled) {
        setShowThrottlingDialog(true);
        return;
      }

      let errorMsg = errorDescription;
      const correlationId = normalizedError.correlationId;

      const clearCacheAction = (
        <ToastAction
          altText="Clear cache"
          onClick={async () => {
            if (!user || !selectedDocId) return;
            try {
              const isAdmin = true; // Simplified for UI; endpoint handles real check
              if (isAdmin) {
                const res = await safeFetch('/api/admin/feature-output', {
                  method: 'DELETE',
                  headers: {
                    Authorization: `Bearer ${session?.access_token}`,
                    'Content-Type': 'application/json',
                    'x-correlation-id': correlationId || '',
                  },
                  body: JSON.stringify({
                    documentId: selectedDocId,
                    feature: 'chat', // Adjust if chat cache clear is supported
                  }),
                });
                if (res.ok) {
                  toast({ title: 'Cache cleared', description: 'You can now retry the generation.' });
                  clearLastError();
                } else {
                  throw new Error('Failed to clear cache');
                }
              }
            } catch (e) {
              // Fallback to ticket template if not admin or failed
              window.open(`mailto:support@datacube-au.vercel.app?subject=Generation Error ${correlationId}&body=Hello, I encountered a generation error with Correlation ID: ${correlationId}. Please clear the cache for this document.`);
            }
          }}
        >
          {normalizedError.code === 'FEATURE_OUTPUT_FAILED' ? 'Ask Admin / Clear' : 'Retry'}
        </ToastAction>
      );

      if (normalizedError.status === 401) {
        errorMsg = "It looks like your session has timed out for security. Please try refreshing the page or logging back in so we can continue our analysis.";
      } else if (normalizedError.status === 403) {
        errorMsg = "You don't have permission to use this chat action right now.";
      } else if (normalizedError.status === 429) {
        errorMsg = "The AU provider is rate-limiting requests right now. Please wait a moment and try again.";
      } else if (normalizedError.code === 'FEATURE_OUTPUT_FAILED') {
        errorMsg = "Generation previously failed for this document. Ask an admin to clear the cache.";
      }
      
      toast({
        variant: 'destructive',
        title: chatErrorTitle(normalizedError),
        description: errorMsg,
        action: clearCacheAction,
      });
    }
  };

  const isLoading = docsLoading || isResponding || isSwitchingDocs;
  const isBootLoading = isLoadingAuth || (docsLoading && currentChatHistory.length === 0 && !isInitialized);
  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(isBootLoading);

  if (isBootLoading && showSkeleton && currentChatHistory.length === 0) {
    return <ChatPageSkeleton />;
  }

  return (
    <main className="relative flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col overflow-hidden">
      {showSlowNotice && isBootLoading ? <SlowNetworkNotice onRetry={() => void refreshDocuments()} /> : null}
      {isUsingCachedData && !isOnline ? (
        <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100 md:mx-8">
          Offline • showing cached chat documents{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}.
        </div>
      ) : null}

      <header className="z-10 flex h-auto shrink-0 flex-col justify-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur-md md:h-14 md:flex-row md:items-center md:justify-end md:px-8">
        <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:flex-row md:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 md:min-w-[200px] md:max-w-[300px] md:flex-none">
              <Select onValueChange={id => handleDocSelection(id)} value={selectedDocId || ''} disabled={docsLoading}>
                <SelectTrigger
                  className="w-full min-w-0 max-w-full overflow-hidden"
                  title={selectedDocName || undefined}
                >
                  <DocumentSelectValue
                    text={selectedDocName}
                    placeholder={docsLoading ? 'Loading docs...' : 'Select a document'}
                    maxWidthClass="max-w-[150px] sm:max-w-[200px] md:max-w-[250px]"
                  />
                </SelectTrigger>
                <SelectContent>
                  {documentList.map(doc => (
                    <SelectItem
                      key={doc.id}
                      value={doc.id}
                      disabled={doc.status !== 'completed'}
                      textValue={doc.fileName}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileNameText
                          text={doc.fileName}
                          maxWidthClass="max-w-[200px] sm:max-w-[300px] md:max-w-[400px]"
                        />
                        {doc.status !== 'completed' && (
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "shrink-0",
                              "h-4 px-1 text-[10px] border-yellow-500 bg-yellow-50 text-yellow-600",
                              doc.status === 'processing' && "animate-pulse"
                            )}
                          >
                            {doc.status === 'processing' ? 'Syncing...' : doc.status}
                          </Badge>
                        )}
                        {doc.type !== 'main_textbook' && (
                           <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                             {doc.type?.replace('_', ' ')}
                           </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground hover:text-primary transition-all duration-300"
                  disabled={!session?.access_token || isLoadingAuth}
                  onClick={() => router.push('/dashboard/global-chat')}
                >
                  <Globe className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Go to Global Chat</p>
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">


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

      {user?.id && (
        <GlobalHistoryPrompt 
          userId={user.id} 
          scope="document"
          onClear={clearChat}
        />
      )}

      <TooltipProvider>
        <div className="flex-1 overflow-hidden relative">
          <ScrollArea id="chat-section" className="h-full flex-1" ref={scrollAreaRef}>
            <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6">
              {/* Summary Mode Banner */}
              <AnimatePresence>
                {connectionStatus === 'reconnecting' && (
                   <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="sticky top-0 z-20 mb-2 overflow-hidden"
                  >
                    <div className="flex items-center justify-center gap-2 rounded-lg bg-yellow-100 px-4 py-2 text-xs font-medium text-yellow-800 border border-yellow-200">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Reconnecting to live updates... (Cached history available)</span>
                    </div>
                  </motion.div>
                )}
                {replyingTo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0, y: -20 }}
                    animate={{ height: 'auto', opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -20 }}
                    className="sticky top-0 z-10 mb-2 overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-medium text-primary shadow-sm backdrop-blur-md">
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <Quote className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          Replying to <strong>{replyingTo.role === 'user' ? 'User' : 'AU'}</strong>: "{replyingTo.content}"
                        </span>
                      </div>
                      <button 
                        onClick={() => setReplyingTo(null)}
                        className="rounded-full p-1 hover:bg-primary/20 transition-colors shrink-0"
                        aria-label="Cancel reply"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </motion.div>
                )}
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
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center text-center max-w-full">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <div className="mt-4 flex flex-col items-center gap-1 min-w-0 max-w-full">
                        <span className="text-muted-foreground shrink-0">Loading</span>
                        {selectedDocName && (
                          <FileNameText 
                            text={selectedDocName} 
                            className="text-muted-foreground font-medium"
                            maxWidthClass="max-w-[200px] sm:max-w-[300px]"
                          />
                        )}
                      </div>
                    </div>
                  ) : selectedDocId ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {QUICK_ACTION_PROMPTS.map((prompt, i) => (
                        <OfflineGuard key={i}>
                          <button onClick={(e) => handleSendMessage(e as unknown as React.FormEvent, prompt)} className="group flex w-full min-w-0 items-start justify-between gap-3 rounded-lg bg-muted p-4 text-left text-sm transition-all hover:-translate-y-1 hover:bg-secondary">
                            <p className="min-w-0 break-words [overflow-wrap:anywhere]">{prompt}</p>
                            <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
                          </button>
                        </OfflineGuard>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground"><p>Select a document above to begin.</p></div>
                  )}
                </div>
              )}

              {currentChatHistory.map((message, idx) => (
                <div key={message.id} className="group/message relative">
                  {message.isSystem ? (
                    <div className="flex justify-center my-6 animate-in fade-in zoom-in duration-300">
                        <span className={`text-[10px] font-medium px-3 py-1 rounded-full flex items-center gap-1.5 border shadow-sm ${message.content.includes("ENABLED") ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-secondary text-muted-foreground border-border"}`}>
                            {message.content.includes("ENABLED") ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                            {message.content}
                        </span>
                    </div>
                  ) : message.role === 'user' ? (
                    <div className="flex items-start gap-4 justify-end">
                      <div className="flex flex-col items-end gap-1 w-full max-w-[85%]">
                        <div className={`relative w-fit max-w-full rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm transition-all group-hover/message:shadow-md`}>
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
                        </div>
                        
                        {/* Message Actions for User - Below bubble, ChatGPT style */}
                         <div className="flex items-center gap-1 mt-1 opacity-50 hover:opacity-100 transition-opacity">
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" 
                             onClick={() => handleReply(message.id, message.content, 'user')} 
                             aria-label="Reply"
                           >
                             <Quote className="h-3.5 w-3.5" />
                           </Button>
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
                        (() => {
                            const sanitizedAnswer = formatAssistantResponseText(message.content);
                            const sanitizedThought = formatAssistantThought(message.thought);
                            const normalizedCitations = normalizeAssistantCitations(message.citations);
                            const followUpPrompts = buildFollowUpSuggestions({
                              answer: sanitizedAnswer,
                              userQuestion: findPreviousUserPrompt(currentChatHistory, idx),
                              documentName: selectedDocName ?? null,
                              isGlobal: false,
                            });
                            return (
                                <div className="space-y-4">
                                  {/* AU Thought Process */}
                                  {sanitizedThought && (
                                    <ThinkingProcess isThinking={false} thought={sanitizedThought} />
                                  )}

                                  <AssistantResponseBody 
                                    content={sanitizedAnswer} 
                                    shouldAnimate={idx === currentChatHistory.length - 1 && isResponding}
                                  />
                                  
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

                                  <FollowUpSuggestions
                                    prompts={followUpPrompts}
                                    disabled={isResponding}
                                    onSelect={(prompt) => {
                                      void handleSendMessage({ preventDefault: () => {} } as React.FormEvent, prompt);
                                    }}
                                  />

                                  {/* Message Actions for AU - Below content, ChatGPT style */}
                                  <div className="flex items-center gap-1 mt-2 opacity-50 hover:opacity-100 transition-opacity">
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" 
                                      onClick={() => handleReply(message.id, sanitizedAnswer, 'assistant')} 
                                      aria-label="Reply"
                                    >
                                      <Quote className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 text-muted-foreground hover:text-primary rounded-md" 
                                      onClick={() => handleCopy(message.id, sanitizedAnswer)}
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
                            );
                        })()
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
          <LimitToast alert={chatLimitToast} onShown={markChatLimitToastShown} />
          {chatRequestError ? (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-destructive">{chatErrorTitle(chatRequestError)}</p>
                  <p className="text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
                    {chatRequestError.message}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {chatRequestError.retryable && lastRetryPayloadRef.current ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const pendingRetry = lastRetryPayloadRef.current;
                        if (!pendingRetry) return;
                        clearLastError();
                        void sendMessage(pendingRetry.message, pendingRetry.options);
                      }}
                    >
                      Retry
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="outline" onClick={clearLastError}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {chatLimitAlert ? (
            <div className="mb-3">
              <LimitAlertCard
                alert={chatLimitAlert}
                onDismiss={(alertId) => {
                  dismissChatLimitAlert(alertId);
                  if (alertId.startsWith('server:')) {
                    clearChatLimitError();
                  }
                }}
              />
            </div>
          ) : null}

          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              {chatMode === 'global' ? (
                  <span className="block break-words">
                      <strong>Global Chat</strong> • App-wide help and navigation. No private document access.
                  </span>
              ) : selectedDocName ? (
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-x-2 sm:gap-y-1">
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <span className="shrink-0">Chatting with:</span>
                    <FileNameText
                      text={selectedDocName}
                      className="font-medium text-foreground"
                      maxWidthClass="max-w-[150px] sm:max-w-[250px] md:max-w-[350px]"
                    />
                  </div>
                  {selectedDocExpiryLabel ? (
                    <span className="sm:shrink-0">
                      • {selectedDocExpiryLabel}
                    </span>
                  ) : null}
                </div>
              ) : (
                'Select a document to start chatting.'
              )}
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

          <form onSubmit={(e) => handleSendMessage(e)} className="flex w-full min-w-0 items-end space-x-2">
            <div className="relative min-w-0 flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isLoading || !selectedDocId || !canChat || upgradeBlocked || !selectedDoc || selectedDoc.status !== 'completed'}
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
                placeholder={
                  !selectedDocId
                    ? "Please select a document to start chatting."
                    : !selectedDoc || selectedDoc.status !== 'completed'
                      ? `Document is ${selectedDoc?.status || 'not ready'}...`
                    : !isOnline
                      ? "Offline mode"
                      : !session?.access_token
                        ? "Sign in required"
                        : "Message AU..."
                }
                className="flex-1 resize-none rounded-full border bg-secondary p-3 pl-12 pr-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (canChat) handleSendMessage(e);
                  }
                }}
                disabled={isLoading || !selectedDocId || !canChat || upgradeBlocked || !selectedDoc || selectedDoc.status !== 'completed'}
              />
              {selectedDocId && !isOnline && (
                <div className="mt-1 pl-3 text-xs text-muted-foreground">Offline mode</div>
              )}
              {selectedDocId && !session?.access_token && isOnline && (
                <div className="mt-1 pl-3 text-xs text-muted-foreground">Sign in required</div>
              )}
              {selectedDocId && selectedDoc && selectedDoc.status !== 'completed' && (
                <div className="mt-1 pl-3 text-xs text-muted-foreground">
                  Document is {selectedDoc.status}. Chat unlocks when processing is completed.
                </div>
              )}
            </div>

            <Button 
              type={isResponding ? "button" : "submit"} 
              size="icon" 
              className={`h-12 w-12 shrink-0 rounded-full transition-all ${isResponding ? 'bg-destructive hover:bg-destructive/90' : ''}`}
              disabled={((!input.trim() || !selectedDocId || !canChat || upgradeBlocked || !selectedDoc || selectedDoc.status !== 'completed') && !isResponding)}
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
            <OfflineGuard>
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
            </OfflineGuard>
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

      <AUThrottlingDialog 
        open={showThrottlingDialog}
        onOpenChange={setShowThrottlingDialog}
        onContactSupport={handleWhatsAppRedirect}
      />
    </main>
  );
}
