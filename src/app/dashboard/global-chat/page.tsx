'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Send,
  ArrowRight,
  Sparkles,
  X,
  MoreVertical,
  Trash2,
  Globe,
  Scissors,
  AlignLeft,
  FileText as FileTextIcon,
  Search,
  MessageSquare,
  Sparkle,
  Check,
  Copy,
  Edit2,
  Plus,
  History,
  Lock,
  RotateCcw,
  Square
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
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
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { validateQuery } from '@/lib/upload/file-types';
import { ThinkingProcess } from '@/components/thinking-process';
import InteractiveConceptMap from '@/components/interactive-concept-map';
import { type ChatMessage } from '@/lib/api/chat';
import { useAuChat } from '@/hooks/api/use-au-chat';
import { Brain } from 'lucide-react';

// Reuse TypingAnimation
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

export default function GlobalChatPage() {
  const { toast } = useToast();
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const isOnline = useOnlineStatus();

  const [isClearChatOpen, setIsClearChatOpen] = useState(false);
  const [browsingMode, setBrowsingMode] = useState(true); // Default ON for Global

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { 
    history, 
    setHistory, 
    isResponding, 
    sendMessage, 
    stopGeneration,
    clearHistory,
    summaryMode,
    updateMetadata,
    draftInput: dbDraftInput,
  } = useAuChat('global');

  const input = dbDraftInput || '';
  const setInput = (val: string) => updateMetadata({ draftInput: val });
  const setSummaryMode = (val: any) => updateMetadata({ summaryMode: val });

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const handleClearHistory = async () => {
    try {
      await clearHistory();
      setIsClearChatOpen(false);
      // Stability > elegance: hard reload after clear
      window.location.reload();
    } catch (error) {
      console.error("[GlobalChat] Error clearing history:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to clear chat history.'
      });
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
    const index = history.findIndex(m => m.id === messageId);
    if (index <= 0) return;
    
    const userMessage = history[index - 1];
    if (userMessage.role !== 'user') return;
    
    const newHistory = history.slice(0, index);
    setHistory(newHistory);
    
    if (mode) {
      setSummaryMode(mode);
    }

    handleSendMessage({ preventDefault: () => {} } as React.FormEvent, userMessage.content);
  };

  const deleteMessage = (messageId: string) => {
     setHistory(prev => prev.filter(m => m.id !== messageId));
   };

   const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
     if (scrollAreaRef.current) {
       const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
       if (viewport) {
         viewport.scrollTo({ top: viewport.scrollHeight, behavior });
       }
     }
   }, []);

   useEffect(() => {
     if (history.length > 0) {
       scrollToBottom();
     }
   }, [history.length, scrollToBottom]);

   const handleSendMessage = async (e: React.FormEvent, customInput?: string) => {
    e.preventDefault();
    const currentInput = (customInput || input).trim();
    if (!currentInput || isResponding || !user) return;

    const validation = validateQuery(currentInput);
    if (!validation.valid) {
      toast({ variant: 'destructive', title: 'Query Error', description: validation.error });
      return;
    }

    if (!customInput) setInput('');

    try {
      await sendMessage(currentInput, {
        browsingMode: true, // Always true for global
        summaryMode
      });
    } catch (error: any) {
      console.error("[GlobalChat] Error:", error);
      toast({
        variant: 'destructive',
        title: 'Global Chat Error',
        description: "I couldn't reach the global intelligence network. Please try again."
      });
    }
  };

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex h-auto flex-col justify-center gap-2 border-b bg-background px-4 py-3 md:h-14 md:flex-row md:items-center md:px-8 shrink-0">
        <h1 className="font-headline text-lg font-semibold md:text-xl">AU Global Intelligence</h1>
        <div className="flex w-full flex-col gap-2 md:ml-auto md:w-auto md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-600 border-indigo-200">
              <Globe className="mr-1 h-3 w-3" />
              Global Search Enabled
            </Badge>

            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10">
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsClearChatOpen(true)} className="text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear Global History
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <TooltipProvider>
        <div className="flex-1 overflow-hidden relative">
          <ScrollArea className="h-full flex-1" ref={scrollAreaRef}>
            <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6">
              {history.length === 0 && !isResponding && (
                <div className="flex h-full flex-col items-center justify-center pt-16">
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold tracking-tight">Global Search Enabled</h2>
                    <p className="mt-2 max-w-md text-muted-foreground mx-auto">
                      Ask me anything! In this workspace, I can search the entire web to provide you with real-time information and broad knowledge.
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {[
                      "What's the latest news in medical technology?",
                      "Explain quantum computing in simple terms.",
                      "How do I optimize my study schedule?",
                      "Compare different programming languages for AI."
                    ].map((suggestion, i) => (
                      <button 
                        key={i} 
                        onClick={(e) => handleSendMessage(e as unknown as React.FormEvent, suggestion)}
                        className="group flex items-start justify-between rounded-lg bg-muted p-4 text-left text-sm transition-all hover:-translate-y-1 hover:bg-secondary"
                      >
                        <p>{suggestion}</p>
                        <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {history.map((message, idx) => (
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
                            {message.thought && (
                              <ThinkingProcess thought={message.thought} />
                            )}

                            <TypingAnimation 
                              content={message.content} 
                              shouldAnimate={idx === history.length - 1 && isResponding}
                            />
                            
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
                              {idx === history.length - 1 && (
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
            </div>
          </ScrollArea>
        </div>

        <div className="border-t bg-background px-4 pb-4 pt-2">
          <div className="relative mx-auto max-w-4xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                AU Global Intelligence
              </div>
            </div>

            <form onSubmit={handleSendMessage} className="flex w-full items-end space-x-2">
              <div className="relative flex-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isResponding || !isOnline}
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
                  placeholder={!isOnline ? "You are offline. AU chat is disabled." : "Ask AU Global anything..."}
                  className="flex-1 resize-none rounded-full border bg-secondary p-3 pl-12 pr-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
                  disabled={isResponding || !isOnline}
                />
              </div>

              <Button 
                type={isResponding ? "button" : "submit"} 
                size="icon" 
                className={`h-12 w-12 shrink-0 rounded-full transition-all ${isResponding ? 'bg-destructive hover:bg-destructive/90' : ''}`}
                disabled={(!input.trim() || !isOnline) && !isResponding}
                onClick={(e) => {
                    if (isResponding) {
                        e.preventDefault();
                        stopGeneration();
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
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              AU Global can browse the web to answer questions beyond your documents.
            </p>
          </div>
        </div>
      </TooltipProvider>

      <AlertDialog open={isClearChatOpen} onOpenChange={setIsClearChatOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Global Chat History?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your global chat history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearHistory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear History
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
