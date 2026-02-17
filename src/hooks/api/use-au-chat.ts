
import { useState, useCallback, useEffect, useRef } from 'react';
import { sendChatMessage, sendChatMessageStream, generatePromptStarters, getAvailableModels, type ChatMessage } from '@/lib/api/chat';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/hooks/use-store';
import { nanoid } from 'nanoid';
import { getMemorySummary, upsertMemorySummary } from '@/lib/api/memory-summaries';
import { appendTurn, clearWorkingMemory, docMemoryKey, globalMemoryKey, loadWorkingMemory, saveWorkingMemory, sweepExpiredDocWorkingMemory, type WorkingMemoryPayload } from '@/lib/memory/working-memory';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { logOnce } from '@/lib/log/dedupe';

const AUTO_CLEAR_MS = 3 * 24 * 60 * 60 * 1000;

// Simple string hash for local cache keys
const simpleHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
};

export function useAuChat(selectedDocId: string | null) {
  const [user, session] = useSupabaseUser();
  const { toast } = useToast();
  const setAuAnimationState = useStore(state => state.setAuAnimationState);
  const setAuThinkingStatus = useStore(state => state.setAuThinkingStatus);
  const setAuThinkingSteps = useStore(state => state.setAuThinkingSteps);
  const updateAuThinkingStep = useStore(state => state.updateAuThinkingStep);
  const { isOnline } = useNetworkStatus();
  
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [promptStarters, setPromptStarters] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [isInitialized, setIsInitialized] = useState(false);

  const ensureAccessToken = useCallback(async (): Promise<string | null> => {
    return await getSupabaseAccessToken();
  }, []);

  const persistHistory = useCallback(async (nextHistory: ChatMessage[]) => {
    if (!selectedDocId || !user?.id) return;
    const scope = selectedDocId === 'global' ? 'global' : 'doc';
    const key = scope === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);
    const current = await loadWorkingMemory(key).catch(() => null);

    const byId = new Map<string, any>();
    const existingTurns = current?.turns ?? [];
    for (const t of existingTurns) byId.set(t.id, t);

    const turns = nextHistory
      .filter((m) => !m.isLoading && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => {
        const prev = byId.get(m.id);
        return { id: m.id, ts: typeof prev?.ts === 'number' ? prev.ts : Date.now(), role: m.role, text: m.content };
      });

    const nextPayload: WorkingMemoryPayload = {
      turns,
      summary: current?.summary ?? '',
      pinnedFacts: current?.pinnedFacts ?? [],
      lastUpdatedAt: current?.lastUpdatedAt ?? Date.now(),
      expiresAt: current?.expiresAt,
      serverUpdatedAt: current?.serverUpdatedAt,
      turnsSinceServerSync: current?.turnsSinceServerSync,
    };

    await saveWorkingMemory(
      key,
      nextPayload,
      scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
    );
  }, [selectedDocId, user?.id]);

  // Helper: Generate Dynamic Thinking Steps
  const generateThinkingSteps = (content: string, type: 'chat' | 'scan' = 'chat') => {
    if (type === 'scan') {
        return [
            { label: 'Mapping document architecture...', status: 'pending' },
            { label: 'Identifying core themes & concepts...', status: 'pending' },
            { label: 'Building analytical roadmap...', status: 'pending' },
            { label: 'Finalizing orchestration guide...', status: 'pending' }
        ];
    }

    const lower = content.toLowerCase();
    const steps: { label: string, status: 'pending' | 'active' | 'completed' }[] = [];

    if (lower.includes('summary') || lower.includes('summarize')) {
        steps.push(
            { label: 'Parsing document structure...', status: 'pending' },
            { label: 'Extracting key themes...', status: 'pending' },
            { label: 'Synthesizing summary...', status: 'pending' }
        );
    } else if (lower.match(/exam|quiz|test|question/)) {
        steps.push(
            { label: 'Analyzing exam patterns...', status: 'pending' },
            { label: 'Retrieving relevant past questions...', status: 'pending' },
            { label: 'Formulating prediction...', status: 'pending' }
        );
    } else {
        // Generic Question
        // Try to extract a keyword
        const words = content.split(' ').filter(w => w.length > 4);
        const keyword = words.length > 0 ? words[Math.floor(Math.random() * words.length)].replace(/[^a-zA-Z]/g, '') : 'context';
        
        steps.push(
            { label: 'Parsing query intent...', status: 'pending' },
            { label: `Scanning for "${keyword}"...`, status: 'pending' },
            { label: 'Cross-referencing context...', status: 'pending' },
            { label: 'Formulating response...', status: 'pending' }
        );
    }
    return steps;
  };

  // ... (Load Models & Persistence Effects) ...
  useEffect(() => {
    if (!user) return;
    if (!isOnline) return;
    if (!session?.access_token) return;

    getAvailableModels()
      .then(models => setAvailableModels(models))
      .catch(err => console.error("Failed to load models:", err));
  }, [isOnline, session?.access_token, user]);

  // --- PERSISTENCE: Load history on mount or doc change ---
  useEffect(() => {
    if (!selectedDocId || !user?.id) {
      setHistory([]);
      setIsInitialized(true);
      return;
    }

    const key = selectedDocId === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);

    if (selectedDocId !== 'global') {
      sweepExpiredDocWorkingMemory().catch(() => {});
    }

    loadWorkingMemory(key)
      .then(payload => {
        const messages = payload?.turns?.map(t => ({ id: t.id, role: t.role, content: t.text } as ChatMessage)) ?? [];
        setHistory(messages);
        setIsInitialized(true);
      })
      .catch(() => {
        setHistory([]);
        setIsInitialized(true);
      });
  }, [selectedDocId, user?.id]);

  const clearChat = useCallback(async () => {
    setHistory([]);
    if (!user?.id || !selectedDocId) return;
    const key = selectedDocId === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);
    await clearWorkingMemory(key).catch(() => {});
  }, [user?.id, selectedDocId]);

  const expiresAt = session?.expires_at ? session.expires_at * 1000 : undefined;

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
      referenceDocId?: string;
    }
  ) => {
    if (!selectedDocId || !user) return;
    if (!isOnline) {
      logOnce('warn', 'chat:send:offline', '[chat] Send blocked (offline)');
      return;
    }

    const accessToken = await ensureAccessToken();
    if (!accessToken) {
      logOnce('warn', 'chat:send:no_token', '[chat] Send blocked (no access token)');
      toast({
        variant: 'destructive',
        title: 'Session expired',
        description: 'Please sign in again to continue chatting.',
        duration: 3000,
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

    const scope = selectedDocId === 'global' ? 'global' : 'doc';
    const memoryKey = scope === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);
    appendTurn(
      memoryKey,
      { id: userMessage.id, ts: Date.now(), role: 'user', text: userMessage.content },
      scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
    ).catch(() => {});
    
    // Initialize Thinking Steps
    const steps = generateThinkingSteps(content, 'chat');
    // @ts-ignore
    setAuThinkingSteps(steps);
    setAuThinkingStatus(steps[0].label);

    let thinkingInterval: any = null;

    // --- OPTIMIZATION: Local Answer Cache Check ---
    const contentHash = simpleHash(content);
    const cacheKey = `au_answer_cache_${selectedDocId}_${contentHash}`;
    const cachedRaw = localStorage.getItem(cacheKey);
    let cachedResult: any = null;

    if (cachedRaw) {
        try {
            cachedResult = JSON.parse(cachedRaw);
            console.log('[useAuChat] Local cache hit');
        } catch (e) {
            localStorage.removeItem(cacheKey);
        }
    }

    try {
      // Step 1: Simulated "Steps" to mimic Trae's thinking behavior
      let currentStep = 0;
      
      // Set first step active immediately
      updateAuThinkingStep(0, 'active');

      thinkingInterval = setInterval(() => {
        if (currentStep < steps.length) {
            // Mark current as done
            updateAuThinkingStep(currentStep, 'completed');
            
            // Move to next
            currentStep++;
            
            if (currentStep < steps.length) {
                updateAuThinkingStep(currentStep, 'active');
                setAuThinkingStatus(steps[currentStep].label);
            }
        } else {
          clearInterval(thinkingInterval);
        }
      }, cachedResult ? 200 : 1200); // Speed up significantly if cached

      let result;

      if (cachedResult) {
          // Simulate brief network delay for UX smoothness
          await new Promise(resolve => setTimeout(resolve, 800));
          result = cachedResult;
          await appendTurn(
            memoryKey,
            { id: loadingId, ts: Date.now(), role: 'assistant', text: String((cachedResult as any)?.answer || '') },
            scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
          );
      } else {
          const existing = await loadWorkingMemory(memoryKey);
          const recentTurns = existing?.turns?.slice(-8).map(t => ({ role: t.role, content: t.text })) ?? [];
          const recentSnippet = {
            mode: 'hybrid' as const,
            summary: existing?.summary,
            turns: recentTurns
          };

          let streamedText = '';

          let secondarySnippet: any | undefined;
          if (options?.referenceDocId && user?.id) {
              try {
                  const { loadWorkingMemory, docMemoryKey } = await import('@/lib/memory/working-memory');
                  const docKey = docMemoryKey(user.id, options.referenceDocId);
                  const docMem = await loadWorkingMemory(docKey);
                  if (docMem) {
                     secondarySnippet = {
                        mode: 'hybrid',
                        summary: docMem.summary,
                        turns: docMem.turns?.slice(-5).map((t: any) => ({ role: t.role, content: t.text })) || []
                     };
                  }
              } catch (e) { console.error('Failed to load secondary memory', e); }
          }

          const done = await sendChatMessageStream(
            {
              selectedDocId,
              doc_id: scope === 'doc' ? selectedDocId : undefined,
              user_input: content,
              recent_snippet: recentSnippet as any,
              secondary_snippet: secondarySnippet,
              memory_pack: scope === 'global' ? { global_digest: existing?.summary || '' } : undefined,
              guide: options?.guide,
              summaryMode: options?.summaryMode,
              browsingMode: options?.browsingMode,
              model: selectedModel === 'auto' ? undefined : selectedModel,
            },
            {
              onEvent: (evt) => {
                if (evt.type === 'delta') {
                  streamedText += evt.text;
                  setHistory(prev => prev.map(m => m.id === loadingId ? { ...m, content: streamedText } as any : m));
                }
              }
            },
            { signal: abortControllerRef.current?.signal }
          );

          result = { answer: done.answer, citations: (done as any).citations, thought: (done as any).thought } as any;

          const turnResult = await appendTurn(
            memoryKey,
            { id: loadingId, ts: Date.now(), role: 'assistant', text: done.answer },
            scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
          );

          // --- SYNC TO SERVER (Long-term Memory) ---
          if ((turnResult.payload.turnsSinceServerSync ?? 0) >= 10) {
            upsertMemorySummary({
              scope: scope as any,
              docId: scope === 'doc' ? selectedDocId : undefined,
              summary: turnResult.payload.summary,
              pinnedFacts: turnResult.payload.pinnedFacts
            }).then(success => {
              if (success) {
                // Reset counter locally
                const next = { ...turnResult.payload, turnsSinceServerSync: 0, serverUpdatedAt: Date.now() };
                saveWorkingMemory(memoryKey, next, scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId });
              }
            });
          }

          // --- OPTIMIZATION: Save to Local Cache ---
          try {
              localStorage.setItem(cacheKey, JSON.stringify(result));
          } catch (e) {
              // Ignore quota errors
          }
      }

      if (thinkingInterval) clearInterval(thinkingInterval);
      
      // Mark all steps complete just in case
      steps.forEach((_, idx) => updateAuThinkingStep(idx, 'completed'));

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
      setAuThinkingStatus('Analytical engine error.');
      setAuThinkingSteps([]); // Clear steps on error
      if (err.name === 'AbortError') {
        console.log('[useAuChat] Message aborted');
        setHistory(prev => prev.filter(m => m.id !== loadingId));
        setAuAnimationState('idle');
        return;
      }
      const msg = String(err?.message || '');
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        logOnce('warn', 'chat:send:unauthorized', '[useAuChat] Message unauthorized', err);
      } else {
        console.error('[useAuChat] Message error:', err);
      }
      setHistory(prev => prev.filter(m => m.id !== loadingId));
      setAuAnimationState('error');
      throw err;
    } finally {
      setIsResponding(false);
      abortControllerRef.current = null;
      // Delay setting back to idle to allow animation to breathe
      setTimeout(() => {
        setAuAnimationState('idle');
        setAuThinkingSteps([]); // Clear steps after done
      }, 3000);
    }
  }, [selectedDocId, user, selectedModel, setAuAnimationState, setAuThinkingStatus, setAuThinkingSteps, updateAuThinkingStep, ensureAccessToken, isOnline, toast]);

  const scanAndGreet = useCallback(async () => {
    if (!selectedDocId || !user) return;
    if (!isOnline) {
      logOnce('warn', 'chat:greet:offline', '[chat] scanAndGreet blocked (offline)');
      return;
    }

    const accessToken = await ensureAccessToken();
    if (!accessToken) {
      logOnce('warn', 'chat:greet:no_token', '[chat] scanAndGreet blocked (no access token)');
      return;
    }
    
    abortControllerRef.current = new AbortController();
    setIsResponding(true);
    setAuAnimationState('thinking');
    
    // Initialize Scan Steps
    const steps = generateThinkingSteps('', 'scan');
    // @ts-ignore
    setAuThinkingSteps(steps);
    setAuThinkingStatus(steps[0].label);

    const loadingId = nanoid();
    // Add a temporary loading indicator if history is empty
    if (history.length === 0) {
        setHistory([{ id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    }

    let thinkingInterval: any = null;
    try {
        let currentStep = 0;
        updateAuThinkingStep(0, 'active');

        thinkingInterval = setInterval(() => {
            if (currentStep < steps.length) {
                updateAuThinkingStep(currentStep, 'completed');
                currentStep++;
                if (currentStep < steps.length) {
                    updateAuThinkingStep(currentStep, 'active');
                    setAuThinkingStatus(steps[currentStep].label);
                }
            } else {
                clearInterval(thinkingInterval);
            }
        }, 1200);

        const result = await sendChatMessage({
            messages: [{ id: 'system-init', role: 'user', content: 'INIT_GREETING' }], // Dummy message
            selectedDocId,
            action: 'scan_and_greet',
            model: selectedModel === 'auto' ? undefined : selectedModel
        }, { signal: abortControllerRef.current?.signal });

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
  }, [selectedDocId, user, history.length, selectedModel, setAuAnimationState, setAuThinkingStatus, setAuThinkingSteps, updateAuThinkingStep, ensureAccessToken, isOnline]);

  const setHistoryPersisted = useCallback((next: ChatMessage[]) => {
    setHistory(next);
    persistHistory(next).catch(() => {});
  }, [persistHistory]);

  const deleteMessagePersisted = useCallback((messageId: string) => {
    setHistory((prev) => {
      const next = prev.filter((m) => m.id !== messageId);
      persistHistory(next).catch(() => {});
      return next;
    });
  }, [persistHistory]);

  const fetchPrompts = useCallback(async (title: string, content: string, idea?: string) => {
    try {
      if (!isOnline) {
        logOnce('warn', 'chat:prompts:offline', '[chat] Prompt generation blocked (offline)');
        return [];
      }
      if (!session?.access_token) {
        logOnce('warn', 'chat:prompts:no_token', '[chat] Prompt generation blocked (no access token)');
        return [];
      }
      if (idea) {
        return await generatePromptStarters(title, content, idea);
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
        });

        const parsed = JSON.parse(result.answer);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Fallback to legacy
      }

      return await generatePromptStarters(title, content);
    } catch (err: any) {
      console.error('[useAuChat] Prompt generation failed:', err);
      return [];
    }
  }, [selectedDocId, session?.access_token, history, isOnline]);

  return {
    history,
    setHistory,
    setHistoryPersisted,
    deleteMessagePersisted,
    isResponding,
    sendMessage,
    stopGeneration,
    scanAndGreet,
    promptStarters,
    fetchPrompts,
    availableModels,
    selectedModel,
    setSelectedModel,
    isInitialized,
    clearChat,
    expiresAt
  };
}
