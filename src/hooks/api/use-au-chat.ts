
import { useState, useCallback, useEffect, useRef } from 'react';
import { sendChatMessage, generatePromptStarters, getAvailableModels, type ChatMessage } from '@/lib/api/chat';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/hooks/use-store';
import { nanoid } from 'nanoid';
import { LocalChatStorage } from '@/lib/storage/local-chat';
import { MemoryLedger } from '@/lib/firebase/memory';

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
  const [user] = useSupabaseUser();
  const { session } = useSupabaseSession();
  const { toast } = useToast();
  const setAuAnimationState = useStore(state => state.setAuAnimationState);
  const setAuThinkingStatus = useStore(state => state.setAuThinkingStatus);
  const setAuThinkingSteps = useStore(state => state.setAuThinkingSteps);
  const updateAuThinkingStep = useStore(state => state.updateAuThinkingStep);
  
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [promptStarters, setPromptStarters] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [isInitialized, setIsInitialized] = useState(false);

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

    getAvailableModels(session?.access_token)
      .then(models => setAvailableModels(models))
      .catch(err => console.error("Failed to load models:", err));
  }, [user, session]);

  // --- PERSISTENCE: Load history on mount or doc change ---
  useEffect(() => {
    if (selectedDocId && user?.id) {
      // Determine Type
      const type = selectedDocId === 'global' ? 'global' : 'au';
      
      // Auto-Cleanup for AU
      if (type === 'au') {
          LocalChatStorage.cleanupExpiredAUChats(user.id);
      }

      // Load Transcript from LocalStorage
      const savedMessages = LocalChatStorage.loadTranscript(type, user.id, selectedDocId);
      setHistory(savedMessages);
      setIsInitialized(true);
    } else if (!selectedDocId) {
      setHistory([]);
      setIsInitialized(true);
    }
  }, [selectedDocId, user?.id]);

  // --- PERSISTENCE: Save history on change ---
  useEffect(() => {
    if (selectedDocId && user?.id && history.length > 0) {
      const type = selectedDocId === 'global' ? 'global' : 'au';
      LocalChatStorage.saveTranscript(type, user.id, selectedDocId, history);
    }
  }, [history, selectedDocId, user?.id]);

  const clearChat = useCallback(() => {
    setHistory([]);
    if (user?.id && selectedDocId) {
      const type = selectedDocId === 'global' ? 'global' : 'au';
      LocalChatStorage.clearThread(type, user.id, selectedDocId);
    }
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
    }
  ) => {
    if (!selectedDocId || !user) return;

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    const userMessage: ChatMessage = { id: nanoid(), role: 'user', content };
    const loadingId = nanoid();
    
    setHistory(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    setIsResponding(true);
    setAuAnimationState('thinking');
    
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
      } else {
          // Prepare Context
          const type = selectedDocId === 'global' ? 'global' : 'au';
          const contextMessages = LocalChatStorage.getRollingContext(type, user.id, selectedDocId, 6); // Last 6 turns
          
          // Prepare Memory Pack (if Global)
          let memoryPack = undefined;
          if (type === 'global') {
              memoryPack = await MemoryLedger.getMemoryPack(user.id);
          }

          result = await sendChatMessage({
            messages: [...contextMessages, userMessage], // Send context + current
            selectedDocId,
            guide: options?.guide,
            summaryMode: options?.summaryMode,
            browsingMode: options?.browsingMode,
            model: selectedModel === 'auto' ? undefined : selectedModel,
            memory: memoryPack // Inject memory
          }, session?.access_token, { signal: abortControllerRef.current?.signal, clientMessageId: userMessage.id });

          // Update Activity (if AU)
          if (type === 'au') {
              // We fire and forget this update
              MemoryLedger.updateAuActivity(user.id, selectedDocId, 'Document Chat'); // We should ideally get doc title here
              MemoryLedger.touchAuThread(user.id, selectedDocId);
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
      console.error('[useAuChat] Message error:', err);
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
  }, [selectedDocId, user, session, history, selectedModel, setAuAnimationState, setAuThinkingStatus, setAuThinkingSteps, updateAuThinkingStep]);

  const scanAndGreet = useCallback(async () => {
    if (!selectedDocId || !user) return;
    
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
        }, session?.access_token, { signal: abortControllerRef.current?.signal });

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
  }, [selectedDocId, user, session, history.length, selectedModel, setAuAnimationState, setAuThinkingStatus]);

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

  return {
    history,
    setHistory,
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
