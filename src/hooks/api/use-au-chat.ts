import { useState, useCallback, useEffect, useRef } from 'react';
import { sendChatMessage, generatePromptStarters, type ChatMessage } from '@/lib/api/chat';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/hooks/use-store';
import { nanoid } from 'nanoid';

export function useAuChat(selectedDocId: string | null) {
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const { toast } = useToast();
  const setAuAnimationState = useStore(state => state.setAuAnimationState);
  const setAuThinkingStatus = useStore(state => state.setAuThinkingStatus);
  const initializeModelRegistry = useStore(state => state.initializeModelRegistry);
  const checkModelHealth = useStore(state => state.checkModelHealth);
  const setModelStatus = useStore(state => state.setModelStatus);
  const selectActiveModel = useStore(state => state.selectActiveModel);
  const setActiveModelId = useStore(state => state.setActiveModelId);
  const modelDiagnostics = useStore(state => state.modelDiagnostics);
  const modelRetryCount = useStore(state => state.modelRetryCount);
  const markRetryScheduled = useStore(state => state.markRetryScheduled);
  
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [promptStarters, setPromptStarters] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const expiresAt = session?.expires_at ? session.expires_at * 1000 : null;

  useEffect(() => {
    let mounted = true;
    (async () => {
      initializeModelRegistry();
      await checkModelHealth({ force: true });
      const state = useStore.getState();
      const noActive = state.models.every(m => m.status !== 'active');
      if (noActive) {
        const retryCount = state.modelRetryCount || 1;
        const delayMs = Math.min(10_000 * Math.pow(2, retryCount - 1), 300_000);
        const nextAt = state.nextRetryAt && state.nextRetryAt > Date.now() ? state.nextRetryAt : Date.now() + delayMs;
        state.markRetryScheduled(nextAt, retryCount);
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(async () => {
          await checkModelHealth({ force: true });
          const after = useStore.getState();
          if (after.models.some(mm => mm.status === 'active')) {
            after.markRetryScheduled(null, 0);
          }
        }, Math.max(0, nextAt - Date.now()));
      }
      if (mounted) setIsInitialized(true);
    })();
    return () => {
      mounted = false;
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [initializeModelRegistry, checkModelHealth]);

  // Helper for LocalStorage Key
  const getStorageKey = useCallback(() => {
    if (!user || !selectedDocId) return null;
    return `au_chat_history_${user.id}_${selectedDocId}`;
  }, [user, selectedDocId]);

  // --- PERSISTENCE: Save to LocalStorage on change ---
  useEffect(() => {
    const key = getStorageKey();
    if (key && history.length > 0) {
      localStorage.setItem(key, JSON.stringify(history));
    }
  }, [history, getStorageKey]);

  // --- PERSISTENCE: Load history on mount or doc change (FROM SUPABASE + FALLBACK) ---
  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
        if (!selectedDocId || !user) {
            setHistory([]);
            return;
        }

        const storageKey = `au_chat_history_${user.id}_${selectedDocId}`;
        const localData = localStorage.getItem(storageKey);
        let localMessages: ChatMessage[] = [];
        if (localData) {
            try {
                localMessages = JSON.parse(localData);
            } catch (e) { console.error('Error parsing local history', e); }
        }

        // If we have local data, show it immediately for speed
        if (localMessages.length > 0 && isMounted) {
            setHistory(localMessages);
        }

        if (!session?.access_token) return;

        try {
            const { getChatHistory } = await import('@/lib/api/chat');
            const messages = await getChatHistory(selectedDocId, session.access_token);
            
            if (isMounted) {
                if (messages && messages.length > 0) {
                    // Server is authority. Use server data.
                    const uiMessages = messages.map(m => ({
                        ...m,
                        id: m.id || nanoid(),
                        isLoading: false
                    }));
                    setHistory(uiMessages);
                    // Update local storage to match server
                    localStorage.setItem(storageKey, JSON.stringify(uiMessages));
                } else if (localMessages.length > 0) {
                    // Server empty, but we have local data. Keep local data (sync gap).
                    // Optionally, we could try to push local to server here, but for now just keep it.
                    console.log('[useAuChat] Server empty, keeping local history.');
                }
            }
        } catch (e) {
            console.error('[useAuChat] Failed to load history from server:', e);
            // On error, if we have local messages, we are good (already set).
            // If no local messages, we stay empty.
        }
    }

    loadHistory();

    return () => { isMounted = false; };
  }, [selectedDocId, user, session?.access_token]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsResponding(false);
    }
  }, []);

  const sendMessage = useCallback(async (
    content: string, 
    options?: { 
      guide?: string; 
      summaryMode?: 'short' | 'mid' | 'detailed' | null;
      browsingMode?: boolean;
    }
  ) => {
    if (!selectedDocId || !user) return;

    if (!session?.access_token) {
      toast({
        title: 'Session initializing',
        description: 'Please try again in a moment.',
      });
      return;
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    const userMessage: ChatMessage = { id: nanoid(), role: 'user', content };
    const loadingId = nanoid();
    
    setHistory(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    setIsResponding(true);
    setAuAnimationState('thinking');
    setAuThinkingStatus('AU is initializing analytical context...');

    let thinkingInterval: any = null;
    try {
      // Step 1: Simulated "Steps" to mimic Trae's thinking behavior
      const isGlobal = selectedDocId === 'global';
      const thinkingSteps = isGlobal ? [
        'Connecting to global knowledge grid...',
        'Analyzing query intent...',
        'Scanning external sources...',
        'Cross-referencing verified data...',
        'Synthesizing comprehensive response...'
      ] : [
        'Searching document index...',
        'Extracting relevant knowledge chunks...',
        'Synthesizing cross-references...',
        'Applying user guide preferences...',
        'Formulating analytical response...'
      ];

      let currentStep = 0;
      thinkingInterval = setInterval(() => {
        if (currentStep < thinkingSteps.length) {
          setAuThinkingStatus(thinkingSteps[currentStep]);
          currentStep++;
        } else {
          clearInterval(thinkingInterval);
        }
      }, 1500);

      await checkModelHealth({ force: true });
      selectActiveModel();

      const runAttempt = async (endpoint: string) => {
        const attemptController = new AbortController();
        const userSignal = abortControllerRef.current?.signal;
        if (userSignal) {
          if (userSignal.aborted) {
            attemptController.abort();
          } else {
            userSignal.addEventListener('abort', () => attemptController.abort(), { once: true });
          }
        }

        const timeoutId = window.setTimeout(() => attemptController.abort(), 20_000);
        try {
          return await sendChatMessage(
            {
              messages: [...history, userMessage],
              selectedDocId,
              guide: options?.guide,
              summaryMode: options?.summaryMode,
              browsingMode: options?.browsingMode,
              model: endpoint,
              signal: attemptController.signal,
            },
            session?.access_token
          );
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      let result: any = null;

      const activeModels = () => useStore.getState().models.filter(m => m.status === 'active');

      for (const m of activeModels()) {
        if (abortControllerRef.current?.signal.aborted) {
          const abortErr: any = new Error('Aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        setActiveModelId(m.id);
        setAuThinkingStatus(`Routing via ${m.provider}...`);

        console.log('[AU Chat Model]', {
          modelId: m.id,
          provider: m.provider,
          endpoint: m.endpoint,
          time: new Date().toISOString(),
        });

        try {
          result = await runAttempt(m.endpoint);
          setModelStatus(m.id, 'active', { lastCheckedAt: Date.now(), lastHttpStatus: 200 });
          markRetryScheduled(null, 0);
          break;
        } catch (e: any) {
          if (e?.name === 'AbortError' && abortControllerRef.current?.signal.aborted) throw e;
          const httpStatus = (e as any)?.status;
          setModelStatus(m.id, 'down', {
            lastFailureAt: Date.now(),
            lastFailureReason: e?.name === 'AbortError' ? 'Timeout' : 'Request failed',
            lastHttpStatus: typeof httpStatus === 'number' ? httpStatus : undefined,
          });
        }
      }

      if (!result) {
        const retryCount = modelRetryCount + 1;
        const delayMs = Math.min(10_000 * Math.pow(2, retryCount - 1), 300_000);
        const nextAt = Date.now() + delayMs;
        markRetryScheduled(nextAt, retryCount);

        setHistory(prev => prev.map(msg => (msg.id === loadingId ? {
          id: loadingId,
          role: 'assistant',
          content: 'AI services are temporarily unavailable. Retrying automatically…',
          isLoading: false,
          isError: true,
        } as any : msg)));

        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(async () => {
          await checkModelHealth({ force: true });
          if (useStore.getState().models.some(mm => mm.status === 'active')) {
            markRetryScheduled(null, 0);
          }
        }, delayMs);

        toast({
          title: 'AI services unavailable',
          description: 'Retrying automatically in the background.',
        });

        if (thinkingInterval) clearInterval(thinkingInterval);
        setAuAnimationState('idle');
        return null;
      }

      if (thinkingInterval) clearInterval(thinkingInterval);
      setAuAnimationState('responding');
      setAuThinkingStatus('Response ready.');
      setHistory(prev => prev.map(m => m.id === loadingId ? {
        id: loadingId,
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        thought: result.thought
      } : m));
      return result;
    } catch (err: any) {
      if (thinkingInterval) clearInterval(thinkingInterval);
      setAuThinkingStatus('AI Service Interruption.');
      
      if (err.name === 'AbortError') {
        console.log('[useAuChat] Message aborted');
        setHistory(prev => prev.filter(m => m.id !== loadingId));
        setAuAnimationState('idle');
        return;
      }
      
      console.log('[AU Chat Error]', { time: new Date().toISOString() });
      toast({
        title: 'AU Chat Issue',
        description: 'AU hit a temporary issue. Please try again.',
        variant: 'destructive',
      });

      setHistory(prev => prev.filter(m => m.id !== loadingId));
      setAuAnimationState('error');
      throw err;
    } finally {
      setIsResponding(false);
      abortControllerRef.current = null;
      // Delay setting back to idle to allow animation to breathe
      setTimeout(() => {
        setAuAnimationState('idle');
      }, 3000);
    }
  }, [
    selectedDocId,
    user,
    session?.access_token,
    history,
    setAuAnimationState,
    setAuThinkingStatus,
    checkModelHealth,
    setModelStatus,
    selectActiveModel,
    setActiveModelId,
    modelDiagnostics,
    modelRetryCount,
    markRetryScheduled,
    toast,
  ]);

  const scanAndGreet = useCallback(async () => {
    if (!selectedDocId || !user) return;
    
    abortControllerRef.current = new AbortController();
    setIsResponding(true);
    setAuAnimationState('thinking');
    setAuThinkingStatus('AU is scanning document architecture...');
    const loadingId = nanoid();
    // Add a temporary loading indicator if history is empty
    if (history.length === 0) {
        setHistory([{ id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    }

    let thinkingInterval: any = null;
    try {
        const thinkingSteps = [
            'Mapping document sections...',
            'Identifying core themes...',
            'Building analytical roadmap...',
            'Finalizing orchestration guide...'
        ];
        let currentStep = 0;
        thinkingInterval = setInterval(() => {
            if (currentStep < thinkingSteps.length) {
                setAuThinkingStatus(thinkingSteps[currentStep]);
                currentStep++;
            } else {
                clearInterval(thinkingInterval);
            }
        }, 1200);

        const result = await sendChatMessage({
            messages: [{ id: 'system-init', role: 'user', content: 'INIT_GREETING' }], // Dummy message
            selectedDocId,
            action: 'scan_and_greet'
        }, session?.access_token);

        if (thinkingInterval) clearInterval(thinkingInterval);
        setAuAnimationState('responding');
        setAuThinkingStatus('Analysis complete.');
        // Replace loading message with greeting
        setHistory(prev => {
            const filtered = prev.filter(m => m.id !== loadingId);
            return [...filtered, {
                id: nanoid(),
                role: 'assistant',
                content: result.answer,
                thought: result.thought
            }];
        });
    } catch (err: any) {
        if (thinkingInterval) clearInterval(thinkingInterval);
        setAuThinkingStatus('Analysis failed.');
        if (err.name === 'AbortError') {
            setHistory(prev => prev.filter(m => m.id !== loadingId));
            setAuAnimationState('idle');
            return;
        }
        console.error('[useAuChat] Greeting failed:', err);
        setHistory(prev => prev.filter(m => m.id !== loadingId));
        setAuAnimationState('error');
    } finally {
        setIsResponding(false);
        abortControllerRef.current = null;
        setTimeout(() => {
          setAuAnimationState('idle');
        }, 3000);
    }
  }, [selectedDocId, user, session, history.length]);

  const fetchPrompts = useCallback(async (title: string, content: string, idea?: string) => {
    try {
      if (idea) {
        return await generatePromptStarters(title, content, idea, session?.access_token);
      }

      // Smart suggestion: Scan chat history and document patterns
      const historyContext = history.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
      
      try {
        const result = await sendChatMessage({
          messages: [{ 
            id: nanoid(),
            role: 'user', 
            content: `Based on the document "${title}" and the recent chat history:\n${historyContext}\n\nGenerate 4 smart and relevant next questions the user might want to ask. The questions should be accurate and tied to the document content. Return ONLY a JSON array of strings.` 
          }],
          selectedDocId: selectedDocId!
        }, session?.access_token);

        const parsed = JSON.parse(result.answer);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Fallback to legacy
      }

      return await generatePromptStarters(title, content, undefined, session?.access_token);
    } catch (err: any) {
      console.error('[useAuChat] Prompt generation failed:', err);
      return [];
    }
  }, [selectedDocId, session, history]);

  const clearChat = useCallback(async () => {
    if (!selectedDocId || !session?.access_token) {
        // Even if no session, try to clear local
        if (user && selectedDocId) {
            localStorage.removeItem(`au_chat_history_${user.id}_${selectedDocId}`);
            setHistory([]);
            window.location.reload();
        }
        return;
    }
    
    try {
        // Clear local first
        if (user) {
            localStorage.removeItem(`au_chat_history_${user.id}_${selectedDocId}`);
        }
        
        const { safeFetch } = await import('@/lib/api/safe-fetch');
        await safeFetch(`/api/chat/history?docId=${selectedDocId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        setHistory([]);
        toast({ title: "Chat cleared", description: "History has been wiped. Reloading..." });
        
        // Force reload to prevent UI freezing/stale state
        setTimeout(() => {
            window.location.reload();
        }, 500);
        
    } catch (e) {
        console.error("Failed to clear chat:", e);
        // Even if server fails, clear local and UI
        if (user) {
             localStorage.removeItem(`au_chat_history_${user.id}_${selectedDocId}`);
             setHistory([]);
        }
        toast({ title: "Error", description: "Failed to clear server history, but local history cleared.", variant: "default" });
        setTimeout(() => {
            window.location.reload();
        }, 500);
    }
  }, [selectedDocId, session?.access_token, toast, user]);

  return {
    history,
    setHistory,
    isResponding,
    sendMessage,
    stopGeneration,
    scanAndGreet,
    promptStarters,
    fetchPrompts,
    expiresAt,
    isInitialized,
    clearChat
  };
}
