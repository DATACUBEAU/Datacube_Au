'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Box, 
  X, 
  ChevronRight, 
  ChevronLeft, 
  MessageSquare, 
  Minimize2, 
  Maximize2,
  Send,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  History,
  Activity,
  User as UserIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useSupabaseUser, useSupabaseSession } from '@/hooks/use-supabase-auth';
import { nanoid } from 'nanoid';
import { usePathname, useRouter } from 'next/navigation';
import { safeFetch } from '@/lib/api/safe-fetch';
import { 
  supabase, 
  getEffectiveOwnershipConditions,
  ensureGuestSession,
  applyOwnershipFilter
} from '@/lib/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import Link from 'next/link';

interface OnboardingStep {
  title: string;
  description: string;
  highlightId?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Welcome to Datacube AU",
    description: "I'm AU, your analytical guide. I'll help you navigate this domain and unlock the power of your data.",
  },
  {
    title: "Knowledge Base",
    description: "Upload your documents here. I'll analyze them to provide deep insights and answer your questions with precision.",
    highlightId: "upload-section"
  },
  {
    title: "AU Chat",
    description: "Once your documents are ready, come here to have intelligent conversations with your data. I use RAG to ensure accuracy.",
    highlightId: "chat-section"
  },
  {
    title: "Predictions",
    description: "Look into the future! Based on your historical data, I can help you forecast trends and patterns.",
    highlightId: "predictions-section"
  },
  {
    title: "Practice Mode",
    description: "Test your understanding. I'll generate challenging questions based on your documents to sharpen your knowledge.",
    highlightId: "practice-section"
  },
  {
    title: "Ready to Start?",
    description: "You're all set! Remember, you can always drag me around if I'm in your way, or minimize me if you need space.",
  }
];

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function AUAssistant() {
  const [user, isUserLoading] = useSupabaseUser();
  const [session, isSessionLoading] = useSupabaseSession();
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDocked, setIsDocked] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [typingContent, setTypingContent] = useState("");
  const [input, setInput] = useState('');
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [mode, setMode] = useState<'onboarding' | 'chat'>('onboarding');
  const [isDraggable, setIsDraggable] = useState(true);
  const [isResponding, setIsResponding] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlightedElement, setHighlightedElement] = useState<string | null>(null);
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastClickTimeRef = useRef<number>(0);

  const handleIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isMinimized && !isDocked) return;

    const now = Date.now();
    const isDoubleClick = now - lastClickTimeRef.current < 300;
    
    if (isDoubleClick) {
      // Double click detected - toggle docking
      setIsDocked(!isDocked);
      setIsMinimized(true);
      lastClickTimeRef.current = 0;
    } else {
      lastClickTimeRef.current = now;
      // Delay single click action to see if a second click follows
      setTimeout(() => {
        if (lastClickTimeRef.current === now) {
          if (isDocked) {
            setIsDocked(false);
          } else if (isMinimized) {
            setIsMinimized(false);
          }
          lastClickTimeRef.current = 0;
        }
      }, 300);
    }
  };

  // Cleanup typing interval on unmount
  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    };
  }, []);

  // Clear highlight when assistant is minimized or closed
  useEffect(() => {
    if (isMinimized || !isOpen) {
      setHighlightedElement(null);
    }
  }, [isMinimized, isOpen]);

  // Effect to apply visual highlight to elements on the page
  useEffect(() => {
    if (!highlightedElement) {
      document.querySelectorAll('.au-focus-highlight').forEach(el => el.classList.remove('au-focus-highlight'));
      return;
    }

    const element = document.getElementById(highlightedElement);
    if (element) {
      element.classList.add('au-focus-highlight');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Auto-remove after 5 seconds
      const timer = setTimeout(() => {
        setHighlightedElement(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [highlightedElement]);

  // Navigation map for smart help
  const NAV_HINTS = [
    { 
      keywords: ['upload', 'file', 'document', 'pdf', 'add data'], 
      path: '/dashboard/documents', 
      label: 'Go to Documents', 
      description: 'You can upload and manage your files here.',
      highlightId: 'upload-section'
    },
    { 
      keywords: ['chat', 'ask', 'question', 'talk to data', 'analyze'], 
      path: '/dashboard/chat', 
      label: 'Go to AU Chat', 
      description: 'This is where you can have conversations with your documents.',
      highlightId: 'chat-section'
    },
    { 
      keywords: ['predict', 'forecast', 'future', 'trend'], 
      path: '/dashboard/predictions', 
      label: 'Go to Predictions', 
      description: 'Analyze patterns and see future forecasts.',
      highlightId: 'predictions-section'
    },
    { 
      keywords: ['practice', 'test', 'quiz', 'exam'], 
      path: '/dashboard/practice', 
      label: 'Go to Practice', 
      description: 'Test your knowledge with document-based quizzes.',
      highlightId: 'practice-section'
    },
    { keywords: ['knowledge graph', 'graph', 'insights', 'overview'], path: '/dashboard/knowledge', label: 'Go to Knowledge Graph', description: 'See a high-level overview of your data relationships and A U insights.', highlightId: 'knowledge-section' },
    { keywords: ['setting', 'profile', 'theme', 'account'], path: '/dashboard/settings', label: 'Go to Settings', description: 'Customize your experience and manage your account.' },
  ];

  // Load progress and update suggestions based on activity
  useEffect(() => {
    if (user) {
      const loadSettings = () => {
        const storedProgress = localStorage.getItem(`au_assistant_progress_${user.id}`);
        const storedSettings = localStorage.getItem(`au_assistant_settings_${user.id}`);
        
        if (storedSettings === 'disabled') {
          setIsVisible(false);
          return;
        }

        if (storedProgress === 'completed') {
          setHasCompletedOnboarding(true);
          // Only hide if we're not currently in an active session or already open
          if (!isOpen && messages.length === 0) {
            setIsVisible(false);
          }
          setMode('chat');
        } else {
          setIsVisible(true);
          setIsOpen(true);
          setMode('onboarding');
        }
      };

      loadSettings();

      // Listen for real-time settings updates
      const handleSettingsUpdate = (e: any) => {
        const { enabled } = e.detail;
        if (!enabled) {
          setIsVisible(false);
        } else {
          // If enabled, re-evaluate visibility based on progress
          loadSettings();
        }
      };

      window.addEventListener('au_assistant_settings_updated', handleSettingsUpdate);
      return () => {
        window.removeEventListener('au_assistant_settings_updated', handleSettingsUpdate);
      };
    }
  }, [user, isOpen, messages.length]);

  // Update suggestions based on current path and activity
  useEffect(() => {
    if (!hasCompletedOnboarding) return;

    const getSuggestions = () => {
      const s: string[] = [];
      
      // Contextual suggestions based on path
      if (pathname === '/dashboard') {
        s.push("What can you do?", "Show my recent activity", "How do I upload documents?");
      } else if (pathname === '/dashboard/documents') {
        s.push("How does analysis work?", "What do status labels mean?", "Can I delete files?");
      } else if (pathname === '/dashboard/chat') {
        s.push("Explain RAG to me", "Summarize my documents", "How to improve accuracy?");
      } else if (pathname === '/dashboard/predictions') {
        s.push("How are forecasts made?", "Is the data secure?", "Show prediction history");
      } else if (pathname === '/dashboard/practice') {
        s.push("Create a new quiz", "How is my score calculated?", "Review previous tests");
      } else if (pathname === '/dashboard/knowledge') {
        s.push("What is a Knowledge Graph?", "How are entities linked?", "Export graph data");
      } else if (pathname === '/dashboard/settings') {
        s.push("Change my theme", "Manage my subscription", "Update profile");
      }
      
      // Cross-linking suggestions (intelligent navigation)
      if (pathname !== '/dashboard/documents' && s.length < 4) {
        s.push("Go to Documents");
      }
      if (pathname !== '/dashboard/chat' && s.length < 4) {
        s.push("Go to AU Chat");
      }
      
      // General fallbacks
      const fallbacks = [
        "Show me around",
        "Who created you?",
        "Show my logs",
        "Where am I right now?"
      ];
      
      while (s.length < 4 && fallbacks.length > 0) {
        const fallback = fallbacks.shift();
        if (fallback && !s.includes(fallback)) {
          s.push(fallback);
        }
      }
      
      setSuggestions(s.slice(0, 4));
    };

    getSuggestions();
  }, [pathname, hasCompletedOnboarding]);

  // Handle auto-cleanup of messages after 1 hour
  useEffect(() => {
    const cleanup = () => {
      const oneHourAgo = Date.now() - 3600000;
      setMessages(prev => prev.filter(m => m.timestamp > oneHourAgo));
    };

    const interval = setInterval(cleanup, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  // Effect for highlighting elements during onboarding
  useEffect(() => {
    if (mode !== 'onboarding' || !isVisible || isMinimized) {
      // Cleanup highlights
      document.querySelectorAll('.tour-highlight').forEach(el => {
        el.classList.remove('tour-highlight');
      });
      return;
    }

    const step = ONBOARDING_STEPS[currentStepIndex];
    if (step.highlightId) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        const target = document.querySelector(`[data-tour="${step.highlightId}"]`);
        if (target) {
          // Remove from others first
          document.querySelectorAll('.tour-highlight').forEach(el => {
            el.classList.remove('tour-highlight');
          });
          target.classList.add('tour-highlight');
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      document.querySelectorAll('.tour-highlight').forEach(el => {
        el.classList.remove('tour-highlight');
      });
    }
  }, [currentStepIndex, mode, isVisible, isMinimized]);

  const handleNext = () => {
    if (currentStepIndex < ONBOARDING_STEPS.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      completeOnboarding();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const completeOnboarding = () => {
    // Cleanup highlights
    document.querySelectorAll('.tour-highlight').forEach(el => {
      el.classList.remove('tour-highlight');
    });

    setHasCompletedOnboarding(true);
    if (user) {
      localStorage.setItem(`au_assistant_progress_${user.id}`, 'completed');
    }
    setMode('chat');
    setIsMinimized(true);
  };

  const handleClose = () => {
    // Cleanup highlights
    document.querySelectorAll('.tour-highlight').forEach(el => {
      el.classList.remove('tour-highlight');
    });
    setIsVisible(false);
  };

  const clearChat = () => {
    setMessages([]);
    setInput('');
  };

  const getRecentLogs = async () => {
    if (!user) return "Please log in to see your activity logs.";
    
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        console.warn("[AU Assistant] Session error:", sessionError.message);
      }
      const token = data.session?.access_token || (typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null);
      
      if (!token) return "I couldn't find a valid session to retrieve your logs.";

      // Fetch uploads
      const conditions = await getEffectiveOwnershipConditions(user);
      const uploadsQuery = supabase
        .from('au_upload_jobs')
        .select('file_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(3);

      applyOwnershipFilter(uploadsQuery, conditions);
      let { data: uploads, error: uploadsError } = await uploadsQuery;

      if (uploadsError && uploadsError.message.includes('guest_session_id')) {
        const retryConditions = conditions.split(',').filter(c => !c.startsWith('guest_session_id')).join(',') || 'id.eq.00000000-0000-0000-0000-000000000000';
        const retryUploadsQuery = supabase
          .from('au_upload_jobs')
          .select('file_name, status, created_at')
          .order('created_at', { ascending: false })
          .limit(3);
        
        applyOwnershipFilter(retryUploadsQuery, retryConditions);
        const { data: uploads2, error: uploadsError2 } = await retryUploadsQuery;
        uploads = uploads2;
        uploadsError = uploadsError2;
      }

      if (uploadsError) {
        console.warn("[AU Assistant] Uploads fetch error:", uploadsError.message);
      }

      // Fetch recent messages
      const messagesQuery = supabase
        .from('au_messages')
        .select('content, role, created_at')
        .order('created_at', { ascending: false })
        .limit(3);

      applyOwnershipFilter(messagesQuery, conditions);
      let { data: messages, error: messagesError } = await messagesQuery;

      if (messagesError && messagesError.message.includes('guest_session_id')) {
        const retryConditions = conditions.split(',').filter(c => !c.startsWith('guest_session_id')).join(',') || 'id.eq.00000000-0000-0000-0000-000000000000';
        const retryMessagesQuery = supabase
          .from('au_messages')
          .select('content, role, created_at')
          .order('created_at', { ascending: false })
          .limit(3);
        
        applyOwnershipFilter(retryMessagesQuery, retryConditions);
        const { data: messages2, error: messagesError2 } = await retryMessagesQuery;
        messages = messages2;
        messagesError = messagesError2;
      }

      if (messagesError) {
        console.warn("[AU Assistant] Messages fetch error:", messagesError.message);
      }

      let logSummary = "";
      if ((uploads && uploads.length > 0) || (messages && messages.length > 0)) {
        logSummary = "Welcome back! Here's a quick rundown of your recent activity:\n\n";
      } else {
        logSummary = "It looks like you're just getting started. Here's what you can do:\n\n";
      }
      
      let suggestions = [];
      
      if (uploads && uploads.length > 0) {
        logSummary += "**Recent Uploads:**\n";
        uploads.forEach((u: any) => {
          logSummary += `- ${u.file_name} (${u.status})\n`;
        });
        
        const processing = uploads.filter((u: any) => u.status === 'processing');
        const failed = uploads.filter((u: any) => u.status === 'failed');
        
        if (processing.length > 0) {
          suggestions.push(`Check status of ${processing[0].file_name}`);
        } else if (failed.length > 0) {
          suggestions.push("Why did my upload fail?");
        } else {
          suggestions.push("Analyze my latest document");
        }
      } else {
        logSummary += "No recent uploads found. Maybe you should upload your first document!\n";
        suggestions.push("How do I upload a file?");
      }

      if (messages && messages.length > 0) {
        logSummary += "\n**Recent Chats:**\n";
        messages.forEach((m: any) => {
          const content = m.content.length > 30 ? m.content.substring(0, 30) + "..." : m.content;
          logSummary += `- "${content}"\n`;
        });
        suggestions.push("Continue our last conversation");
      }

      // Context-aware suggestions based on current path
      if (pathname.includes('predictions')) {
        suggestions.push("How do predictions work?");
      } else if (pathname.includes('practice')) {
        suggestions.push("Can I generate a custom quiz?");
      } else if (pathname.includes('documents')) {
        suggestions.push("How do I organize my files?");
      }

      // Add a smart suggestion based on overall activity
      if (uploads && messages && uploads.length > 5 && messages.length < 2) {
        logSummary += "\n*Insight: I see you've uploaded many documents. Try asking me questions about them in the Chat!*";
        suggestions.push("How do I use AU Chat?");
      } else if (uploads && uploads.length > 0 && pathname === '/dashboard') {
        suggestions.push("Take me to my documents");
      }

      // Unique suggestions
      setSuggestions([...new Set(suggestions)]);
      return logSummary;
    } catch (e) {
      console.error("[AU Assistant] Error fetching logs:", e);
      return "I couldn't retrieve your logs right now. Please try again later.";
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, directMessage?: string) => {
    if (e) e.preventDefault();
    const currentInput = directMessage || input.trim();
    if (!currentInput || isResponding) return;

    const lowerInput = currentInput.toLowerCase();
    if (!directMessage) setInput('');
    setIsResponding(true);

    const userMsg: AssistantMessage = {
      id: nanoid(),
      role: 'user',
      content: currentInput,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);

    let response = "";

    // Function to handle assistant response with typing animation
    const handleAssistantResponse = (content: string) => {
      // Clear any existing interval
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);

      const assistantMsg: AssistantMessage = {
        id: nanoid(),
        role: 'assistant',
        content: content,
        timestamp: Date.now()
      };
      
      setTypingId(assistantMsg.id);
      setTypingContent("");
      let i = 0;
      typingIntervalRef.current = setInterval(() => {
        setTypingContent(prev => content.slice(0, i + 1));
        i++;
        if (i >= content.length) {
          if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
          typingIntervalRef.current = null;
          setMessages(prev => [...prev, assistantMsg]);
          setTypingId(null);
          setTypingContent("");
        }
      }, 15);
    };

    try {
      // Direct navigation check
      const navTarget = NAV_HINTS.find(hint => 
        hint.keywords.some(kw => lowerInput.includes(kw))
      );

      if (lowerInput.includes('who made you') || lowerInput.includes('who created you') || lowerInput.includes('creator')) {
        response = "I was created by Fabian, a developer dedicated to making data analysis intuitive and powerful. He built me to be your companion in exploring the Datacube AU ecosystem!";
      } else if (lowerInput.includes('where am i') || lowerInput.includes('current page') || lowerInput.includes('current path') || lowerInput.includes('path')) {
        response = `You are currently on the ${pathname} page. This is where you're ${
          pathname.includes('documents') ? 'managing your knowledge base' :
          pathname.includes('chat') ? 'interacting with your data' :
          pathname.includes('predictions') ? 'forecasting future trends' :
          pathname.includes('practice') ? 'testing your knowledge' : 'getting a birds-eye view of your data'
        }.`;
      } else if (lowerInput.includes('log') || lowerInput.includes('activity') || lowerInput.includes('rundown')) {
        response = await getRecentLogs();
      } else if (lowerInput.includes('show me around') || lowerInput.includes('tutorial') || lowerInput.includes('walkthrough') || lowerInput.includes('onboarding')) {
        response = "Of course! I'd be happy to show you around again. Let's restart our quick tour of the Datacube AU ecosystem.";
        setMode('onboarding');
        setCurrentStepIndex(0);
        setIsOpen(true);
        setIsMinimized(false);
        setIsDocked(false);
      } else if (navTarget && (lowerInput.includes('go to') || lowerInput.includes('take me to') || lowerInput.includes('show me') || lowerInput.includes('how do i') || lowerInput.includes('where is') || lowerInput.includes('where do i'))) {
        const isCurrentPath = pathname === navTarget.path;
        
        if (isCurrentPath) {
          response = `You're already on the ${navTarget.label.replace('Go to ', '')} page! ${navTarget.description}`;
          if (navTarget.highlightId && !isMobile) {
            response += "\n\nI've highlighted the relevant section for you on this page.";
            setHighlightedElement(navTarget.highlightId);
          } else if (navTarget.highlightId && isMobile) {
            response += "\n\nLook for the section marked with our special indicator.";
            setHighlightedElement(navTarget.highlightId);
          }
        } else {
          response = `I can help with that! You'll find what you're looking for on the ${navTarget.label.replace('Go to ', '')} page. ${navTarget.description}`;
          
          if (isMobile) {
            response += "\n\nI've added a navigation button below for you.";
          } else {
            response += "\n\nClick the button below to head there now!";
          }
        }
      }

      // 3. Edge function call
      if (!response) {
        const payload: any = {
          messages: [{ role: 'user', content: currentInput }],
          useRAG: true,
          currentPath: pathname,
        };

        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
        const accessToken = session?.access_token;

        if (!SUPABASE_URL) {
          throw new Error("Supabase URL is not configured. Please check your environment variables.");
        }

        const result = await safeFetch(`${SUPABASE_URL}/functions/v1/au-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        
        response = result.answer || "I'm having a bit of trouble reaching my knowledge core right now. Is there something else I can help you with in the meantime?";
      }

      handleAssistantResponse(response);
      
    } catch (err: any) {
      console.error("[AU Assistant] Message error:", err);
      
      let errorMsg = "I'm sorry, I encountered an unexpected hitch while processing your request. My analytical circuits might be a bit overloaded—could you try asking that again in a moment?";
      
      if (err.status === 401) {
        errorMsg = "It looks like your session has timed out for security. Please try refreshing the page or logging back in so we can continue our analysis.";
      } else if (err.message?.includes('fetch')) {
        errorMsg = "I'm having trouble connecting to the network. Please check your connection and I'll be here when you're back online.";
      }

      handleAssistantResponse(errorMsg);
    } finally {
      setIsResponding(false);
    }
  };

  if (!isVisible && !isOpen) {
    return (
      <button 
        onClick={() => { setIsVisible(true); setIsOpen(true); setIsMinimized(false); }}
        className={`fixed z-50 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110 active:scale-95 ${isMobile ? 'bottom-4 right-4 h-10 w-10' : 'bottom-6 right-6 h-12 w-12'}`}
      >
        <Box className={isMobile ? "h-5 w-5" : "h-6 w-6"} />
      </button>
    );
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          drag={!isMobile && isDraggable && !isDocked}
          dragMomentum={false}
          dragElastic={0.1}
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ 
            opacity: 1, 
            scale: 1, 
            y: 0,
            width: isDocked 
              ? (isMobile ? '24px' : '32px')
              : isMinimized 
                ? (isMobile ? '48px' : '64px') 
                : (isMobile ? 'calc(100% - 32px)' : '360px'),
            height: isMinimized || isDocked
              ? (isMobile ? '48px' : '64px') 
              : (isMobile ? 'min(600px, 85vh)' : '550px'),
            bottom: isMobile ? '16px' : '24px',
            right: isDocked 
              ? (isMobile ? '-12px' : '-16px') 
              : (isMobile ? '16px' : '24px'),
            borderRadius: isMinimized || isDocked ? (isMobile ? '24px' : '32px') : '16px',
          }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className={`fixed z-[100] flex flex-col overflow-hidden border bg-background/95 backdrop-blur-md shadow-2xl transition-all duration-300 ${(isMinimized || isDocked) ? 'items-center justify-center cursor-pointer hover:bg-muted' : ''} ${isDocked ? 'opacity-50 hover:opacity-100' : ''}`}
          onClick={handleIconClick}
        >
          {isMinimized || isDocked ? (
            <motion.div 
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={`flex items-center justify-center rounded-full bg-primary text-primary-foreground transition-all ${isMobile ? 'h-10 w-10' : 'h-12 w-12'} ${isDocked ? 'translate-x-[-25%]' : ''}`}
            >
              <Box className={isMobile ? "h-5 w-5" : "h-6 w-6"} aria-hidden="true" />
            </motion.div>
          ) : (
            <>
              {/* Header */}
              <div 
                className={`flex items-center justify-between border-b bg-muted/50 px-4 py-3 group ${!isMobile ? 'cursor-move' : ''}`}
                onMouseEnter={() => !isMobile && setIsDraggable(true)}
              >
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                    <Box className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold leading-none">AU Assistant</h3>
                      {!isMobile && isDraggable && (
                        <div className="flex gap-0.5 opacity-20 group-hover:opacity-50 transition-opacity">
                          <div className="h-1 w-1 rounded-full bg-foreground" />
                          <div className="h-1 w-1 rounded-full bg-foreground" />
                          <div className="h-1 w-1 rounded-full bg-foreground" />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Domain of Analytical Unit</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {mode === 'chat' && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setMode('onboarding'); 
                        setCurrentStepIndex(0);
                        setIsMinimized(false);
                        setIsDocked(false);
                      }}
                      title="Restart Tutorial"
                    >
                      <HelpCircle className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  {messages.length > 0 && mode === 'chat' && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); clearChat(); }}
                      title="Clear chat"
                    >
                      <History className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7"
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setIsMinimized(true);
                      setIsDocked(false);
                    }}
                    aria-label="Minimize"
                  >
                    <Minimize2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 text-destructive"
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      handleClose();
                      setIsDocked(false);
                    }}
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-hidden relative" onMouseEnter={() => !isMobile && setIsDraggable(false)}>
                {mode === 'onboarding' ? (
                  <div className="flex h-full flex-col p-6 text-center">
                    <div className="mb-4 flex justify-center">
                      <div className="rounded-full bg-primary/10 p-3 text-primary animate-pulse">
                        <Sparkles className="h-8 w-8" aria-hidden="true" />
                      </div>
                    </div>
                    <h4 className="mb-2 text-lg font-bold">{ONBOARDING_STEPS[currentStepIndex].title}</h4>
                    <p className="text-sm text-muted-foreground flex-1">
                      {ONBOARDING_STEPS[currentStepIndex].description}
                    </p>
                    
                    <div className="mt-6 flex items-center justify-between">
                      <div className="flex gap-1">
                        {ONBOARDING_STEPS.map((_, i) => (
                          <div 
                            key={i} 
                            className={`h-1.5 w-1.5 rounded-full transition-all ${i === currentStepIndex ? 'w-4 bg-primary' : 'bg-muted'}`}
                          />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        {currentStepIndex > 0 && (
                          <Button variant="outline" size="sm" onClick={handleBack}>
                            Back
                          </Button>
                        )}
                        <Button size="sm" onClick={handleNext}>
                          {currentStepIndex === ONBOARDING_STEPS.length - 1 ? 'Finish' : 'Next'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col">
                    <ScrollArea className="flex-1 p-4">
                      {messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center text-center p-4">
                          <HelpCircle className="h-10 w-10 text-muted-foreground/30 mb-4" aria-hidden="true" />
                          <p className="text-sm text-muted-foreground">
                            Welcome back! I'm AU. How can I help you today?
                          </p>
                          <div className="mt-4 grid grid-cols-1 gap-2 w-full">
                            {suggestions.map((s, i) => (
                              <Button 
                                key={i}
                                variant="outline" 
                                size="sm" 
                                className="justify-start h-auto py-2 px-3 text-left text-xs"
                                onClick={() => handleSendMessage(undefined, s)}
                              >
                                <Sparkles className="h-3 w-3 mr-2 shrink-0" aria-hidden="true" />
                                {s}
                              </Button>
                            ))}
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="justify-start h-auto py-2 px-3 text-left text-xs"
                              onClick={() => handleSendMessage(undefined, "Show my recent logs")}
                            >
                              <Activity className="h-3 w-3 mr-2 shrink-0" aria-hidden="true" />
                              Show my recent logs
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {messages.map((m, index) => {
                            const matchingHint = m.role === 'assistant' ? NAV_HINTS.find(hint => 
                              m.content.includes(hint.path) || 
                              m.content.toLowerCase().includes(hint.label.toLowerCase().replace('go to ', '')) ||
                              (m.content.toLowerCase().includes('take you there') && index > 0 && 
                               NAV_HINTS.some(h => messages[index-1]?.content.toLowerCase().includes(h.keywords[0])))
                            ) : null;

                            return (
                              <div key={m.id} className="flex flex-col gap-2">
                                <div className={`flex items-start gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  {m.role === 'assistant' && (
                                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                      <Box className="h-3 w-3" aria-hidden="true" />
                                    </div>
                                  )}
                                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground rounded-tr-none' : 'bg-muted border rounded-tl-none'}`}>
                                    <div className="leading-relaxed">{m.content}</div>
                                    <div className={`mt-1 text-[10px] opacity-50 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                  </div>
                                  {m.role === 'user' && (
                                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                                      <UserIcon className="h-3 w-3" aria-hidden="true" />
                                    </div>
                                  )}
                                </div>
                                {matchingHint && (
                                  <div className="flex justify-start pl-8">
                                    <Button 
                                      size="sm" 
                                      variant="secondary" 
                                      className="h-8 text-xs gap-1 animate-in fade-in slide-in-from-left-2 duration-300"
                                      onClick={() => {
                                        router.push(matchingHint.path);
                                        if (isMobile) setIsMinimized(true);
                                      }}
                                    >
                                      <ChevronRight className="h-3 w-3" />
                                      {matchingHint.label}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {typingId && (
                            <div className="flex items-start gap-2 justify-start">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                <Box className="h-3 w-3" aria-hidden="true" />
                              </div>
                              <div className="max-w-[85%] rounded-2xl bg-muted border px-3 py-2 text-sm whitespace-pre-wrap">
                                {typingContent}
                                <span className="inline-block w-1.5 h-3.5 bg-primary ml-1 animate-pulse" />
                              </div>
                            </div>
                          )}
                          {isResponding && !typingId && (
                            <div className="flex items-start gap-2">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                <Box className="h-3 w-3 animate-spin" aria-hidden="true" />
                              </div>
                              <div className="rounded-2xl bg-muted px-3 py-2 text-sm">
                                <span className="flex gap-1">
                                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40" />
                                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0.2s]" />
                                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0.4s]" />
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </ScrollArea>
                    <form onSubmit={handleSendMessage} className="border-t p-3 bg-muted/30">
                      <div className="flex gap-2">
                        <Input 
                          placeholder="Type your question..." 
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          className="h-9 text-xs"
                          onFocus={() => !isMobile && setIsDraggable(false)}
                          disabled={isResponding}
                        />
                        <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!input.trim() || isResponding}>
                          <Send className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
